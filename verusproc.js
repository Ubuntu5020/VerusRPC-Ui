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
        
        this.lastBlockGetVolume = 0;
        this.lastCoinPaprikaCoin = "";
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
    
    async getCoinPaprikaTickers() {
      // if currency id is known currency on coinpaprika
      let j = undefined;
      let r = await this.getHttpsResponse("https://api.coinpaprika.com/v1/tickers?quotes=BTC,USD");
      try {
        j = JSON.parse(r)
        if (j.error && j.type && j.soft_limit) {
          console.log("coinpaprika.error", j.type, j.soft_limit, "blocked for", j.block_duration);
          j = undefined;
        } else if (j.error) {
          console.log("coinpaprika.error", j.error);
          j = undefined;
        }
      } catch {
        j = undefined;
      }
      return j;
    }

    async monitorConversions() {
      // monitor conversions
      let conversions = this.verus.get_conversions();
      for (let i in conversions) {
        let c = conversions[i];
        // check to see if this conversion is the reverse of a previous conversion
        let matches = this.verus.get_conversion_by_details(c.convertto, c.currency, c.destination, c.amount, 0.5);
        if (matches.length > 0) {
          for (let i in matches) {
            //if (c.started > matches[i].started) {
              if (!c.closedby && !c.closed && matches[i].status === "success") {
                c.closed = matches[i].uid;
                matches[i].status="closed";
                matches[i].closedby = c;
                console.log("conversion position closed", matches[i].uid, "with", c.uid, c);
              }
            //}
          }
        }
        // check conversions for progress
        if (c.status !== "closed") {
          // do some estimates
          if (c.status == "success" || c.estimate) {
            // estimate converting back
            if (!c.estimate_reverse) { c.estimate_reverse = {}; }
            // estimate direct conversion
            let e = await this.verus.estimateConversion(c.received||c.estimate, c.convertto, c.currency, c.via, false);
            if (e) {
              let via = " "; // via not used
              if (c.via) { via = c.via; }
              c.estimate_reverse[via] = e.estimatedcurrencyout;
            }
          }
          
          // check spentTxId's for progress
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
    
    async cacheCoinPaprika() {
      let market = await this.getCoinPaprikaTickers();
      if (market) {
        for (let i in market) {
          let ticker = market[i];
          if (coinpaprikaids[ticker.id]) {
            let currency = this.verus.currencies[this.verus.currencyids[coinpaprikaids[ticker.id]]];
            if (currency) {
              this.verus.set_market_ticker(currency.fullyqualifiedname, ticker);
            }
          }
        }
      } else {
        console.log("failed to get market data from coinpaprika for", name);
      }
    }
    
    async recacheTemplateVars() {
      let now = Date.now();
      
      if (this.templateCacheInterval < (now - this.lastTemplateCache)) {
        console.log("cache full update...");
        // cache market stats
        await this.cacheCoinPaprika();
        // keep template variables cache up to date
        await this.verus.getTemplateVars(false);
        this.lastTemplateCache = Date.now();        
        
      } else {        
        // keep checking critical cache items like opid/txid monitoring
        await this.verus.getTemplateVars(undefined);
      }

      await this.monitorConversions();
      
      /* TODO price/volume tracking
      if (this.verus.info && this.lastBlockGetVolume != this.verus.info.blocks) {
        if (this.lastBlockGetVolume === 0) { this.lastBlockGetVolume = this.verus.info.blocks; }
        await this.verus.getVolume("Bridge.vETH", this.lastBlockGetVolume, this.verus.info.blocks);
        this.lastBlockGetVolume = this.verus.info.blocks;
      }
      */
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