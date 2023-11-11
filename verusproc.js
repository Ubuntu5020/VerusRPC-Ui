const https = require("node:https");

const coinpaprikaids = require("./coinpaprika.json");

// scans verusd for balances, and things ...
class VerusPROC {
    constructor(rpc, verbose=0) {
        this.verus = rpc;
        this.running = false;
        this.executing = false;
        this.interval = 5000;
        
        this.templateCacheInterval = 60000;
        this.lastTemplateCache = 0;
        this.verbose = verbose;
    }
        
    async getHttpsResponse(url) {
      let p = new Promise((resolve, reject) => {
        let rawData = '';
        https.get(url, (res) => {
          res.setEncoding('utf8');
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => { resolve(rawData); });
        }).on('error', (e) => {
          console.error("https.get("+url+") failed:", e);
          resolve(rawData);
        });
      });
      return await p;
    }
    
    async getCoinPaprikaTicker(currencyId) {
      // if currency id is known currency on coinpaprika
      let j = undefined;
      let cpobj = coinpaprikaids[currencyId];
      if (cpobj) {
        let r = await this.getHttpsResponse(cpobj.ticker);
        try {
          j = JSON.parse(r)
        } catch {
          j = undefined;
        }       
      }
      return j;
    }

    async recacheTemplateVars() {
      let now = Date.now();
      if (this.templateCacheInterval < (now - this.lastTemplateCache)) {
        console.log("cache full update...");
        // keep template variables cache up to date
        await this.verus.getTemplateVars(false);
        this.lastTemplateCache = Date.now();
        // update market prices for known currencies
        for (let name in this.verus.currencies) {
          let currency = this.verus.currencies[name];
          let market = await this.getCoinPaprikaTicker(currency.currencyid);
          if (market) {
            this.verus.set_market_ticker(name, market);
          }
        }
        
      } else {
        console.log("cache quick update...");
        // keep checking critical cache items like opid/txid monitoring
        await this.verus.getTemplateVars(undefined);
      }

      // monitor conversions
      let conversions = this.verus.get_conversions();
      for (let i in conversions) {
        let c = conversions[i];
        // check to see if this conversion closes the position of a previous conversion
        let matches = this.verus.get_conversion_by_details(c.convertto, c.currency, c.destination, c.amount);
        if (matches.length > 0) {
          for (let i in matches) {
            if (matches[i].status == "success") {
              matches[i].status="closed";
              matches[i].closedby=c;
              console.log("closed conversion position", matches[i].txid, "with", c.txid);
            }
          }
        }
        
        // check conversions for progress
        if (c.status !== "closed") {
          if (c.status == "success") {
            // monitor estimates for conversion back
            let e = await this.verus.estimateConversion(c.received, c.convertto, c.currency, c.via, false);
            if (e) {
              c.estimate_reverse = e.estimatedcurrencyout;
            }
          }
          if (c.spentTxId2) {
            let tx = await this.verus.getRawTransaction(c.spentTxId2, false, false);
            if (!tx || tx.error) {
              console.log("failed to get spentTxId2 for conversion! falling back ...");
            } else {
              continue;
            }
          }
          if (c.spentTxId) {
            let tx = await this.verus.getRawTransaction(c.spentTxId, false, false);
            if (!tx || tx.error) {
              console.log("failed to get spentTxId for conversion! falling back ...");
            } else {
              continue;
            }
          }
          console.log("checking conversion txid for progress", c.txid);
          await this.verus.getRawTransaction(c.txid, false, false);
        }
      }
    }
    
    async runOnce() {
      // start      
      let start = Date.now();
      if (this.verbos > 0) {
        console.log(start, "VerusPROC.runOnce start");
      }
      this.executing = true;
      // always clean the cache ...
      await this.verus.cleanCache();
      // monitor balances
      await this.recacheTemplateVars();
      // done
      this.executing = false;
      let end = Date.now();
      if (this.verbos > 0) {
        console.log(end, "VerusPROC.runOnce took", (end - start), "ms");
      }
    }
    
    async run() {
      if (this.running) {
        await this.runOnce();
        if (this.running) {
          setTimeout(this.run.bind(this), this.interval);
        }
      }
    }
    
    async start() {
      this.running = true;
      setTimeout(this.run.bind(this), 1);
    }

    async stop() {
      this.running = false;
    }
}

module.exports = VerusPROC;