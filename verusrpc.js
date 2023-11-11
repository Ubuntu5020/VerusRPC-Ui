const crypto = require('crypto');

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

const explorers = require("./explorers.json");

const RPC_CACHE_DB_NAME = "cacherpc";
const RPC_CACHE_TIMEOUT = 60000; // milli seconds


const IS_TOKEN_FLAG = 0x20;
const IS_FRACTIONAL_FLAG = 0x01;
const IS_PBAAS_FLAG = 0x100;
const IS_GATEWAY_FLAG = 0x80;
const IS_GATEWAY_CONVERTER_FLAG = 0x200;
const IS_NFT_TOKEN_FLAG = 0x800;

function checkOptionsFlag(integer, flag) {
  return (flag & integer) == flag;
}

var currentBlockHeight = 0;

class VerusRPC {
    constructor(url, user, pass, verbose=0) {
        this.url = url;
        this.user = user;
        this.pass = pass;
        this.verbose = verbose;
        this.curid = 0;
        this.opids = [];
        this.ops = {};
        this.txids = [];
        this.txs = {};
        this.minconf = 10;
        this.addresses = {};
        this.balances = {};
        this.info = {};
        this.nextblockreward = {};
        this.mininginfo = {};
        this.currencynames = [];
        this.currencies = {};
        this.tickers = {};
        this.prelaunch = {};
        this.conversions = [];

        // initially populated with known ids > fullyqualifiedname
        this.currencyids = {
          i5w5MuNik5NtLcYmNzcvaoixooEebB6MGV: 'VRSC',
          i9nwxtKuVYX4MSbeULLiK2ttVi6rUEhh4X: 'vETH',
          i3f7tSctFkiPpiedY8QR5Tep9p4qDVebDx: 'Bridge.vETH',
          iCkKJuJScy4Z6NSDK7Mt42ZAB2NEnAE1o4: 'MKR.vETH',
          iGBs4DWztRNvNEJBt4mqHszLxfKTNHTkhM: 'DAI.vETH'
        };
    }

    db_get(query, params) {
      return new Promise((resolve, reject) => {
        this.db.get(query, params, (err, row) => {
          if(err) {
            reject(err);
          } else {
            resolve(row);
          }
        });
      });
    }
    
    db_run(query, params) {
      return new Promise((resolve, reject) => {
        this.db.run(query, params, (err) => {
          if(err) {
            reject(err);
          } else {
            resolve(!err);
          }
        });
      });
    }
    
    async init() {
      let p = new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(':memory:', (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(!err);
          }
        });
      });
      await p;
      await this.createCache();
    }
        
    getnativecoin() {
      let coin = "VRSC";
      if (this.info && this.info.name) {
        coin = this.info.name;
      } else if (this.currencynames.length > 0) {
        coin = this.currencynames[0];
      } else {
        console.error("getnativecoin: assuming VRSC is native currency");
      }
      return coin;
    }
    
    async createCache() {
         let q = `CREATE TABLE `+RPC_CACHE_DB_NAME+` (
  method TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);`;
      let success = await this.db_run(q, []);
      if (!success) {
        console.log("ERROR: create_table", q, success); 
        return false;
      }
      return true;
    }

    async cleanCache() {
      let q = `DELETE FROM `+RPC_CACHE_DB_NAME+` WHERE timestamp<?;`;
      let p = [Date.now()-RPC_CACHE_TIMEOUT];
      let r = await this.db_get(q, p);
    }

    async updateCache(method, params, response) {
      let uid = method + JSON.stringify(params);
      let hash = crypto.createHash('md5').update(uid).digest("hex");
      let sql = `INSERT OR REPLACE INTO `+RPC_CACHE_DB_NAME+`(method,response,timestamp) VALUES(?,?,?);`;
      let p = [ hash, response, Date.now() ];
      let r = await this.db_run(sql, p);
      return r;
    }

    async getCache(method, params) {
      let uid = method + JSON.stringify(params);
      let hash = crypto.createHash('md5').update(uid).digest("hex");
      let sql = `SELECT response,timestamp FROM `+RPC_CACHE_DB_NAME+` WHERE method=?;`;
      let p = [ hash ];
      let r =  await this.db_get(sql, p);
      return r;
    }
    
    // *Note, just in case we need to format something when building rpc request to daemon
    jsonReplacer(key, value) {
      // force 8 decimal precision for "amount" fields (string is ok to send to daemon)
      if (key == "amount" && typeof value === 'number'){
        return value.toFixed(8);
      }
      return value;
    }
    
    set_market_ticker(name, ticker) {
      if (this.currencies[name]) {
        this.tickers[name] = ticker;
      }
    }
    
    get_closest(numbers, number) {
      let closest = numbers.reduce(function(prev, curr) {
        return (Math.abs(curr - number) < Math.abs(prev - number) ? curr : prev);
      });
      return closest;
    }
    
    add_opid(op) {
      let opid = op.id;
      if (opid) {
        if (!this.ops[op.id]) {
          this.ops[op.id] = op
          this.opids.push(op.id);
          console.log("added opid", op.id, "to monitor");
          return true;
        } else {
          if (this.ops[op.id].status != op.status) {
            this.ops[op.id] = op;
            console.log("updated opid", op.id);
            return true;
          }
        }
      }
      return false;
    }
    remove_opid(op) {
      let opid = op.id;
      const index = this.opids.indexOf(opid);
      if (index > -1) {
        this.opids.splice(index, 1);
      }
      if (this.ops[opid]) {
        console.log("remove opid", opid, "from monitor");
        delete this.ops[opid];
      }
    }

    add_txid(txid) {
      if (this.txids.indexOf(txid) < 0) {
        this.txids.push(txid);
        console.log("new txid", txid);
        return true;
      }
      return false;
    }
    remove_txid(txid) {
      const index = this.txids.indexOf(txid);
      if (index > -1) {
        this.txids.splice(index, 1);
      }
      if (this.txs[txid]) {
        console.log("remove txid", txid, "from monitor");
        delete this.txs[txid];
      }
    }
    async add_conversion(txid, currency, convertto, via, amount, destaddr, spentTxId) {
      let sid = txid+currency+convertto+via+amount;
      let uid = crypto.createHash('sha256').update(sid).digest().toString('hex');
      let c = {
        uid: uid,
        txid: txid,
        status:"pending",
        amount: amount,
        currency: currency,
        convertto: convertto,
        via: via,
        destination: destaddr,
        started: Date.now(),
        spentTxId: spentTxId
      };
      for (let i in this.conversions){
        let conv = this.conversions[i];
        if (conv.txid == c.txid &&
            conv.currency == c.currency &&
            conv.convertto == c.convertto &&
            conv.destination == c.destination) {
            return false;
        }
      }
      // get the estimate now
      let e = await this.estimateConversion(amount, currency, convertto, via, false);
      if (e) {
        c.estimate = e.estimatedcurrencyout;
      }
      this.conversions.push(c);
      console.log("new conversion", txid, c);
      return true;
    }
    remove_conversion(uid) {
      let f = false;
      let i = 0;
      while (i < this.conversions.length) {
        let c = this.conversions[i];
        if (c.uid == uid) {
          this.conversions.splice(i, 1);
          f = true;
        } else {
          ++i;
        }
      }
      return f;
    }
    remove_conversion_by_details(txid, amount, currency, convertto, destination) {
      let f = false;
      let i = 0;
      while (i < this.conversions.length) {
        let c = this.conversions[i];
        if (c.txid == txid &&
            c.amount == amount &&
            c.currency == currency &&
            c.convertto == convertto &&
            c.destination == destination) {
            this.conversions.splice(i, 1);
            f = true;
        } else {
          ++i;
        }
      }
      return f;
    }
    remove_conversion_by_txid(txid) {
      let f = false;
      let i = 0;
      while (i < this.conversions.length) {
        let c = this.conversions[i];
        if (c.txid == txid) {
          this.conversions.splice(i, 1);
          f = true;
        } else {
          ++i;
        }
      }
      return f;
    }
    get_conversions() {
      return this.conversions;
    }
    get_conversion_by_uid(uid) {
      for (let i in this.conversions) {
        let c = this.conversions[i];
        if (c.uid == uid) {
          return c;
        }
      }
      return undefined;
    }
    get_conversion_by_details(currency, convertto, destination, received) {
      let matches = [];
      for (let i in this.conversions) {
        let c = this.conversions[i];
        if (c.received == received &&
            c.currency == currency &&
            c.convertto == convertto &&
            c.destination == destination) {
            matches.push(c);
        }
      }
      return matches;
    }
    get_conversion_by_txid(txid) {
      let matches = [];
      for (let i in this.conversions) {
        let c = this.conversions[i];
        if (c.txid == txid) {
          matches.push(c);
        }
        if (c.spentTxId == txid) {
          matches.push(c);
        }
        if (c.spentTxId2 == txid) {
          matches.push(c);
        }
      }
      return matches;
    }

    // method = string
    // params = array
    async request(method, params=[], useCache=undefined) {
        let result = undefined;

        // check cache first
        let orig_start = Date.now();
        let start = orig_start;
        let cache = await this.getCache(method, params);
        if (cache && useCache !== false) {
          if (useCache === true || Date.now() - cache.timestamp < RPC_CACHE_TIMEOUT) {            
            return { result: JSON.parse(cache.response), error:undefined };
          }
        }
        let end = Date.now();
        let cacheTotalMs = end - start;
        
        let data = JSON.stringify({
            jsonrpc: "1.0",
            id: this.curid,
            params: params,
            method: method
        }, this.jsonReplacer);

        this.curid = (this.curid + 1) & 0xff;

        start = Date.now();
        const rsp = await axios.post(this.url, data, {
            auth: {
                username: this.user,
                password: this.pass
            },
            headers: {                
                'Content-Type': 'application/json;charset=utf-8',
                'Content-Length': Buffer.byteLength(data, 'utf8'),
                'Connection': 'close'
            }
        }).catch(function (error) {
            if (error.response) {
              // The request was made and the server responded with a status code
              // that falls out of the range of 2xx
              //console.log(error.response.headers);
              if (error.response.data.error) {
                  result = {result: undefined, error: error.response.data.error};
              } else if (error.response.statusText) {
                  result = {result: undefined, error: {message: error.response.statusText}};
              } else if (error.response.status) {
                  result = {result: undefined, error: {message: error.response.status}};
              } else {
                result = {result: undefined, error: "unknown response error"};
                console.log("RSP ERROR:", error.response);
              }
            } else if (error.request) {
              result = {result: "", error: {message: "connection rejected or timeout"}};
            } else {
              result = {result: "", error: {message: "unknown error"}};
              console.log("AXIOS ERROR:", error);
            }
            
        }).then(function (response) {
            if (response) {
                if (response.data) {
                  if (!response.data.error && response.data.result) {
                      result = {result: response.data.result, error: undefined};
                      
                  } else if (response.data.error) {
                      result = {result: undefined, error: response.data.error};
                  } else {
                      result = {result: "", error: undefined};
                  }
                } else {
                  console.log(response);
                }
            } else if (!result) {
              result = {result: "", error: undefined};
            }
        });
        
        await rsp;
        end = Date.now();
        let rpcTotalMs = end - start;
        if (result.result !== undefined) {
          start = Date.now();
          this.updateCache(method, params, JSON.stringify(result.result));
          end = Date.now();
          cacheTotalMs += (end - start);
        }

        end = Date.now();
        let total_time = (end - orig_start);
        if (this.verbose > 1) {
          console.log("RPC `"+data+"` took", total_time +"ms; rpc took", rpcTotalMs + "ms; cache took", cacheTotalMs + "ms");
        } else if (this.verbose > 0 || rpcTotalMs > 5000 || cacheTotalMs > 250) {
          console.log("RPC `"+method+"` took", total_time +"ms; rpc took", rpcTotalMs + "ms; cache took", cacheTotalMs + "ms");
        }

        return result;
    }
    
    async isOnline() {
      let rsp = await this.request("getinfo", [], false);
      let r = { online: (rsp && !rsp.error)};
      if (r.online) {
        if (rsp.result.chainid && rsp.result.name) {
          let ncurrency = await this.getCurrency(rsp.result.name, false);
          if (ncurrency) {
            console.log("Detected native chain", {chainid: rsp.result.chainid, name: rsp.result.name});
          } else {
            console.error("Failed to fetch native currency details from daemon");
          }
        }
        r.VRSCversion = rsp.result.VRSCversion;
        r.blocks = rsp.result.blocks;
        r.longestchain = rsp.result.longestchain;
      } else if (rsp.error) {
        r.error = rsp.error;
      } else {
        r.error = rsp;
      }
      return r;
    }
    
    async isValidAddress(address) {
      // quick sanity check
      if (!address || typeof address != "string" || address.length < 2) return false;

      let rpcMethod = "validateaddress";
      if (address.startsWith("zs1")) {
        rpcMethod = "z_validateaddress";
      }
      if (address.endsWith("@")) {
        rpcMethod = "getidentity";
      }
      let rsp = await this.request(rpcMethod, [address], false);
      if ((rsp && !rsp.error)) {
          if (rsp.result.identity && rsp.result.identity.name) {
            return address.toLowerCase().startsWith(rsp.result.identity.name.toLowerCase());
          }
          return (rsp.result.isvalid === true);
      } else if (!rsp.error) {
        console.error(rsp);
      }
      return false;
    }

    async waitForOnline() {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
      let r = await this.isOnline();
      while (!r.online) {
          if (r.error && r.error.code == -28) {
            console.log("waiting 5 second, verusd startup:", r.error);
            await delay(5000) /// waiting 5 second. 
          } else {
            console.log("waiting 15 seconds, verusd offline:", r.error);
            await delay(15000) /// waiting 15 second. 
          }
          r = await this.isOnline();
      }
      return r;
    }
    
    async getTemplateVars(useCache=undefined) {      
      this.info = await this.getInfo(useCache);
      this.nextblockreward = await this.getNextBlockReward(useCache);
      this.mininginfo = await this.getMiningInfo(useCache);
      this.currencynames = await this.listCurrencies(useCache);
      this.addresses = await this.getAddresses(useCache);
      this.balances = await this.getBalances(0, useCache);
      const opids = await this.listOperationIDs(useCache);
      const txids = await this.monitorTransactionIDs(useCache);
      const opid_counts = {};
      const keys = Object.keys(opids);
      for (let key in keys) {
        opid_counts[keys[key]] = Object.keys(opids[keys[key]]).length;
      }
      // sanity check
      if (!this.info) {
        this.info = {};
      }
      if (!this.addresses) {
        this.addresses = {};
      }
      if (!this.balances) {
        this.balances = {};
      }
      if (!this.mininginfo) {
        this.mininginfo = {};
      }
      if (!this.nextblockreward) {
        this.nextblockreward = {};
      }
      return {
        coin: this.getnativecoin(),
        coins: Object.values(this.balances.currencies),
        balances: this.balances,
        prelaunch_count: Object.keys(this.prelaunch).length,
        prelaunch: this.prelaunch,
        currencynames: this.currencynames,
        currencyids: this.currencyids,
        currencies: this.currencies,
        conversions: this.conversions,
        addresses: this.addresses,
        txid_count: this.txids.length,
        txids: txids,
        opid_count: this.opids.length,
        opid_counts: opid_counts,
        opids: opids,
        info: this.info,
        nextblockreward: this.nextblockreward,
        mininginfo: this.mininginfo,
        tickers: this.tickers,
        explorers: explorers
      };
    }

    async monitorTransactionIDs(useCache=undefined) {
      for (let i in this.txids) {
        let r = await this.getRawTransaction(this.txids[i], (useCache===true?true:false), true);
        if (!r || r.error) {
          console.error("failed to get transaction details for", this.txids[i]);
        }
      }
      // return full tx details
      let r = {};
      for (let tx in this.txs) {
        r[this.txs[tx].txid] = this.txs[tx];
      }
      return r;
    }
    
    isMyAddress(address) {
      for (let o in this.addresses) {
        for (let a in this.addresses[o]) {
          if (this.addresses[o][a] === address) {
            return true;
          }
        }
      }      
      return false;
    }
    
    async getRawTransaction(txid, useCache=undefined, monitoringTx=false) {
      let tx = undefined;
      let rsp = await this.request("getrawtransaction", [txid, 1], useCache);
      if (rsp && !rsp.error) {
        tx = rsp.result;
        if (tx && tx.txid == txid) {
          if (useCache === false) {
            // monitoring ?
            if (monitoringTx === true) {
              if (!this.txs[tx.txid]) {
                this.txs[tx.txid] = tx;
                console.log("add txid", tx.txid, "to monitor");
              } else if (tx.height && !this.txs[tx.txid].height) {
                this.txs[tx.txid] = tx;
                console.log("txid", tx.txid, "included in block", tx.height);
              } else if (tx.confirmations && tx.confirmations >= this.minconf) {
                console.log("txid", tx.txid, "confirmed");
                this.remove_txid(tx.txid);
              } else if (tx.confirmations && tx.confirmations != this.txs[tx.txid].confirmations) {
                this.txs[tx.txid] = tx;
                if (tx.confirmations < 0) {
                  console.log("txid", tx.txid, "orphaned", tx.confirmations, "of", this.minconf, "confirmations...");
                } else {
                  console.log("txid", tx.txid, "pending", tx.confirmations, "of", this.minconf, "confirmations...");
                }
              } else if (tx.expiryheight && !tx.height && !tx.confirmations) {
                if (tx.expiryheight > currentBlockHeight) {
                  if (this.txs[tx.txid].expiresin != (tx.expiryheight - currentBlockHeight)) {
                    console.log("txid", tx.txid, "expires in", (tx.expiryheight - currentBlockHeight), "blocks");
                  }
                } else {
                  console.log("txid", tx.txid, "expired", (currentBlockHeight - tx.expiryheight), "blocks ago");
                }
              } else if (!tx.height && !tx.confirmations) {
                console.log("unknown state for txid", tx.txid, tx);
              }
            }

            // detect conversions that we need to monitor
            if (tx.vout && Array.isArray(tx.vout)) {
              let cmatches = this.get_conversion_by_txid(txid);
              
              let used_vout_n = [];
              let vout_amounts = [];
              let conversions_success = [];

              // parse outputs in transaction for conversion progress
              for (let i in tx.vout) {
                let amount = 0;
                let o = tx.vout[i];
                if (o.scriptPubKey) {
                  let s = o.scriptPubKey;
                  // detect conversion starts
                  if (s.reservetransfer) {
                    let convert = s.reservetransfer.convert === true;
                    let r2r = s.reservetransfer.reservetoreserve === true;
                    let valuesbyid = s.reservetransfer.currencyvalues;
                    let fees = s.reservetransfer.fees;
                    let fcurrencyid = s.reservetransfer.feecurrencyid
                    let destcurrencyid = s.reservetransfer.destinationcurrencyid;
                    let via = this.currencyids[s.reservetransfer.via];
                    let destination = s.reservetransfer.destination.address;
                    let isMine = this.isMyAddress(destination);
                    let values = {};
                    for (let i in valuesbyid) {
                      values[this.currencyids[i]] = valuesbyid[i];
                    }
                    if (convert & isMine) {
                      let currency = undefined;
                      let amount = undefined;
                      for (let i in values) {
                        currency = i;
                        amount = values[i];
                        //console.log(fees);
                        // add conversion
                        this.add_conversion(txid, currency, this.currencyids[destcurrencyid], via, amount, destination, o.spentTxId);
                        // update spentTxId for active conversions
                        if (o.spentTxId) {
                          for(let i in cmatches) {
                            let conversion = cmatches[i];
                             // keep original spentTxid in sync
                            if (!conversion.spentTxId || conversion.spentTxId != o.spentTxId) {
                              conversion.spentTxId = o.spentTxId;
                            }
                          }
                        }
                      }
                    }

                  } else {

                    // check for progress on existing conversions
                    for(let i in cmatches) {
                      let conversion = cmatches[i];
                      if (o.scriptPubKey) {
                        // check forward progress in spendTxId
                        if (s.finalizeexport && o.spentTxId && (!conversion.spentTxId2 || conversion.spentTxId2 != o.spentTxId)) {
                          conversion.spentTxId2 = o.spentTxId;
                        }
                        let isMine = false;
                        for (let i in s.addresses) {
                          if (conversion.destination == s.addresses[i]) {
                            isMine = true;
                          }
                        }
                        if (isMine) {
                          // get all our 'n' amounts in outputs
                          if (s.reserveoutput && s.reserveoutput.currencyvalues && txid != conversion.txid && conversion.spentTxId && conversion.spentTxId2) {
                            // make sure the conversion is for the currency
                            let fname = this.currencyids[Object.keys(s.reserveoutput.currencyvalues)[0]];
                            if (fname === conversion.convertto) {
                              amount = s.reserveoutput.currencyvalues[Object.keys(s.reserveoutput.currencyvalues)[0]];
                              if (conversion.status === "pending") {
                                conversion.status = "complete";
                                conversion.received = amount;
                              }
                            }
                          } else if (o.value && o.value > 0.0 && txid != conversion.txid && conversion.spentTxId && conversion.spentTxId2) {
                            // make sure the conversion is for the native coin
                            if (conversion.convertto === this.getnativecoin()) {                              
                              amount = o.value;
                              if (conversion.status === "pending") {
                                conversion.status = "complete";
                                conversion.received = amount;
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                  
                }

                vout_amounts.push(amount);
              }
              
              for(let i in cmatches) {
                let conversion = cmatches[i];
                if (conversion.status === "complete") {
                  conversion.status = "success";
                  conversion.finish = Date.now();
                  let closestIndex = 0;
                  let closest = this.get_closest(vout_amounts, conversion.estimate);
                  for (let i in vout_amounts) {
                    if (vout_amounts[i] == closest) {
                      closestIndex = i;
                    }
                  }
                  if (closest !== conversion.received) {
                    console.log("conversion fixup, received does not match closest to estimate!", conversion.received, closest);
                    conversion.received = closest;
                  }
                  console.log("conversion success", conversion.txid, conversion);
                }
              }
            }
          }

        } else {
          console.error("unexpected txid ", (tx?tx.txid:''), " expected", txid);
        }
        
      } else if (rsp.error) {
        
        tx = { txid: txid, error: rsp.error };
        console.error("error response with getrawtransaction", txid, rsp.error);
        if (monitoringTx === true) {
          if (!this.txs[tx.txid]) {
            this.txs[tx.txid] = tx;
            console.log("add txid", tx.txid, "to monitor on error response", rsp.error);
          }  
        }

      } else {
        console.error("error with getrawtransaction", txid, rsp);
      }
      
      // remove some extra data we dont care about
      tx.hex = undefined;
      tx.vin = tx.vin&&tx.vin.length?tx.vin.length:undefined;
      tx.vout = tx.vout&&tx.vout.length?tx.vout.length:undefined;
      tx.vjoinsplit = tx.vjoinsplit&&tx.vjoinsplit.length?tx.vjoinsplit.length:undefined;
      tx.vShieldedSpend = tx.vShieldedSpend&&tx.vShieldedSpend.length?tx.vShieldedSpend.length:undefined;
      tx.vShieldedOutput = tx.vShieldedOutput&&tx.vShieldedOutput.length?tx.vShieldedOutput.length:undefined;
      tx.valueBalance = tx.valueBalance?tx.valueBalance:undefined;
      tx.bindingSig = undefined;
      tx.overwintered = undefined;
      
      return tx;
    }

    async listOperationIDs(useCache=undefined) {
      // never use cache unless told otherwise      
      await this.getOperationStatus([], (useCache===true?true:false));

      let r = {};

      // get counts of status types
      for(let opid in this.ops) {
        let op = this.ops[opid];
        if (op) {
          if (!op.status) { op.status = "unknown"; }
          if (!r[op.status]) {
            r[op.status] = 1;
          } else {
            r[op.status] += 1;
          }
        }
      }
      
      // add ops list
      r.ops = this.ops;

      return r;
    }
    
    async getOperationStatus(opids, useCache=undefined) {
      let r = undefined;
      let r_opids = [];
      // support single opid string input or array of opids as input
      if (opids) {
        if (Array.isArray(opids)) {
          r_opids = opids;
        } else {
          r_opids.push(opids);
        }
      }      
      let rsp = await this.request("z_getoperationstatus", [r_opids], useCache);
      if (rsp && !rsp.error) {
        r = rsp.result;
        for (let i in r) {
          let op = r[i];
          if (op) {
            // add to opid monitoring
            if (useCache===false) {
              //op.method = undefined;
              //op.params = undefined;
              this.add_opid(op);
            }
            // success
            if (op.result && op.result.txid) {
              // do not auto clear if we are trying to be fast with cache
              if (useCache === false) {
                  // clear from daemon by getting result
                  await this.getOperationResult(op.id, false);
              }
            }
          }
        }
      }
      return r;
    }
    
    async getOperationResult(opids, useCache=undefined) {
      let r = undefined;
      let r_opids = [];
      if (opids) {
        if (Array.isArray(opids)) {
          r_opids = opids;
        } else {
          r_opids.push(opids);
        }
      }
      let rsp = await this.request("z_getoperationresult", [r_opids], useCache);
      if (rsp && !rsp.error) {
        r = rsp.result;
        for (let i in r) {
          let op = r[i];
          if (op) {
            if (op.result && op.result.txid) {
              if (useCache === false) {
                // add txid for monitoring
                this.add_txid(op.result.txid);
              }
            }
            // clear from monitoring
            this.remove_opid(op);
          }
        }
      }
      return r;
    }
    
    async getFeeEstimate(nblocks=1) {
      let fee = 0.0001; // default to z-addr min
      let rsp = await this.request("estimatefee", [nblocks], false);
      if (rsp && !rsp.error) {
        fee = rsp.result;
      }
      return fee;
    }

    async estimateConversion(amount, from, to, via, useCache) {
      let r = undefined;
      let rsp = await this.request("estimateconversion", [{"amount":amount, "currency":from, "convertto":to, "via":via}], useCache);
      if (rsp && !rsp.error) {
        r = rsp.result;
      }
      return r;
    }
    
    async sendCurrency(fromAddress, toArray=[], minconf=1, fee=0, verifyFirst=true) {
      let r = { invalid:[] };

      // if undefined, or empty string use * wildchar
      if (!fromAddress || (fromAddress && fromAddress.length == 0)) {
        fromAddress = "*";
      }
      // support wildchar in fromAddress
      if(fromAddress != "*" && fromAddress != "R*" && fromAddress != "i*") {
        // basic sanity check for user supplied data
        let validFrom = await this.isValidAddress(fromAddress);
        if (!validFrom) {
          r.invalid.push("fromAddress");
        }
      }
      
      let rpcMethod = "sendcurrency";

      if (toArray.length == 0) {
        r.invalid.push("toAddress0");
        r.invalid.push("amount0");
      }

      let hasPublicAddress = false;
      for (let i in toArray) {
        let to = toArray[i];
        let validTo = await this.isValidAddress(to.address);
        if (!validTo) {
          r.invalid.push("toAddress"+i);
        }
        if (!to.address.startsWith("zs1")) {
          hasPublicAddress = true;
        }

        // use default if undefined
        if (!to.currency) {
          to.currency = this.getnativecoin();
        } else if (!this.currencies[to.currency]) {
          r.invalid.push("currency"+i);
        }
        
        // amount must be a positive number
        if (Number.isNaN(to.amount) || to.amount <= 0) {
          to.amount = 0;
          r.invalid.push("amount"+i);
        }
        to.amount = to.amount.toFixed(8);

        // z-addr can only accept native currency
        if (to.address.startsWith("zs1") && to.currency != this.getnativecoin()) {
          r.invalid.push("currency"+i);
        } else {
          // use z_sendmany when sending to self
          if (fromAddress == to.address && fromAddress.startsWith("zs1")) {
            // z_sendmany only works with native currency and does not support currency param
            rpcMethod = "z_sendmany";
          }
        }
        // if using z_sendmany, do not send currency unsupported
        if (to.address.startsWith("zs1") || rpcMethod == "z_sendmany") {
          to.currency = undefined;
        }
      }

      // can not send to self using z_sendmany with public addresses present
      if (hasPublicAddress && rpcMethod == "z_sendmany") {
        r.invalid.push("fromAddress");
      }

      let params = [fromAddress, toArray, minconf];
      if (fee && ( Number.isNaN(fee) || fee <= 0 )) {
        fee = undefined
        r.invalid.push("fee");
      }
      if (fee && fee > 0) { params.push(fee); }

      // clear invalid if needed
      r.invalid = r.invalid.length>0?r.invalid:undefined;

      // verifyFirst!
      if (verifyFirst || r.invalid) {
        r.verify = true;
        r.method = rpcMethod;
        r.params = params;
        return r;
      }

      console.log(rpcMethod, params);

      let rsp = await this.request(rpcMethod, params, false);
      if (rsp && !rsp.error) {
        r = {};
        r.opid = rsp.result;
        if (r.opid) {
          await this.getOperationStatus([r.opid], false);
        }
      } else {
        r = rsp;
      }

      return r;
    }

    async getNextBlockReward(useCache=undefined) {
      let r = undefined;
      let rsp = await this.request("getblocktemplate", [], useCache);
      if (rsp && !rsp.error) {
          r = {height: rsp.result.height, reward: 0, previousblockhash: rsp.result.previousblockhash, bits: rsp.result.bits, mergeminebits: rsp.result.mergeminebits};
          rsp = await this.request("decoderawtransaction", [rsp.result.coinbasetxn.data], useCache);
          if (rsp && !rsp.error) {
            if (rsp.result.vout && Array.isArray(rsp.result.vout) && rsp.result.vout[0].value) {
              r.reward = rsp.result.vout[0].value;
            }
          } else {
            console.error(rsp);
          }
      } else {
        console.error(rsp);
      }
      return r;
    }
    
    async getInfo(useCache=undefined) {
      let data = undefined;
      let rsp = await this.request("getinfo", [], useCache);
      if (rsp && !rsp.error) {
          data = rsp.result;
          currentBlockHeight = data.blocks;
      } else {
        console.error(rsp);
      }
      return data;
    }
    
    async getMiningInfo(useCache=undefined) {
      let data = undefined;
      let rsp = await this.request("getmininginfo", [], useCache);
      if (rsp && !rsp.error) {
          data = rsp.result;
      } else {
        console.error(rsp);
      }
      return data;
    }
    
    async getReserves(currency, name) {
      if (this.currencies[currency] && this.currencies[currency].bestcurrencystate && this.currencies[currency].bestcurrencystate.reservecurrencies) {
        for (let i in this.currencies[currency].bestcurrencystate.reservecurrencies) {
          let c = this.currencies[currency].bestcurrencystate.reservecurrencies[i];
          let cname = this.currencyids[c.currencyid];
          if (cname === name) {
            return c.reserves;
          }
        }
      }
      return -1;
    };
    
    async getReserveCurrencyPrice(currency, base, to) {
      let baseReserves = await this.getReserves(currency, base);
      let toReserves = await this.getReserves(currency, to);
      if (baseReserves > 0) {
        return baseReserves / toReserves;
      }
      return -1;
    }
    
    async getCurrency(lookup, useCache=undefined) {
      let r = undefined;
      let d = await this.request("getcurrency", [lookup], useCache);
      if (d && !d.error) {
        let currencyid = d.result.currencyid;
        let name = d.result.fullyqualifiedname;
        if (this.currencies[name]) {
          this.currencies[name] = d.result;
        } else {
          this.currencies[name] = d.result;
          this.currencyids[currencyid] = name;
          this.currencynames.push(name);
        }

        // detection of options
        d.result.isToken = checkOptionsFlag(d.result.options, IS_TOKEN_FLAG);
        d.result.isFractional = checkOptionsFlag(d.result.options, IS_FRACTIONAL_FLAG);
        d.result.isPBaaS = checkOptionsFlag(d.result.options, IS_PBAAS_FLAG);
        d.result.isGateway = checkOptionsFlag(d.result.options, IS_GATEWAY_FLAG);
        d.result.isGatewayConverter = checkOptionsFlag(d.result.options, IS_GATEWAY_CONVERTER_FLAG);
        d.result.isNFT = checkOptionsFlag(d.result.options, IS_NFT_TOKEN_FLAG);

        // attempt to find value (pricing)
        if (this.currencies[name].bestcurrencystate && this.currencies[name].bestcurrencystate.reservecurrencies) {
          // calculate "peg" prices between each reserve currency
          for (let i in this.currencies[name].bestcurrencystate.reservecurrencies) {
            let c = this.currencies[name].bestcurrencystate.reservecurrencies[i];
            for (let z in this.currencies[name].bestcurrencystate.reservecurrencies) {
              let d = this.currencies[name].bestcurrencystate.reservecurrencies[z];
              let base = this.currencyids[c.currencyid];
              let cname = this.currencyids[d.currencyid];
              let priceBASE = await this.getReserveCurrencyPrice(name, base, cname);
              if (priceBASE > -1 && Number.isFinite(priceBASE)) {
                if (!this.currencies[name].bestcurrencystate.reservecurrencies[z].prices) { this.currencies[name].bestcurrencystate.reservecurrencies[z].prices = {}; }
                this.currencies[name].bestcurrencystate.reservecurrencies[z].prices[base] = priceBASE;
              }
            }
          }
        }
        
        r = d.result;
        
        // add any cached market tickers from coinpaprika
        if (this.tickers[d.result.fullyqualifiedname]) {
          r.coinpaprika = this.tickers[d.result.fullyqualifiedname];
        }
      }

      return r;
    }
    
    async listCurrencies(useCache=undefined) {      
      let rsp = await this.request("listcurrencies", [], useCache);
      if (rsp && !rsp.error) {
        let list = rsp.result;
        for (let i in list) {
          if (list[i].currencydefinition && list[i].currencydefinition.fullyqualifiedname) {
            let name = list[i].currencydefinition.fullyqualifiedname;
            if (!this.currencies[name] || useCache === false) {
              let currency = await this.getCurrency(name, useCache);
              if (currency) {
                if (currency.isGateway) {
                  let parentid = currency.currencyid;
                  let parentname = currency.fullyqualifiedname;
                  let l = await this.request("listcurrencies", [{fromsystem:parentid}], useCache);
                  if (l && !l.error && l.result) {
                    for (let r in l.result) {
                      if (l.result[r] && l.result[r].currencydefinition && l.result[r].currencydefinition.fullyqualifiedname) {
                        let name2 = l.result[r].currencydefinition.fullyqualifiedname;
                        let currency2 = await this.getCurrency(name2, useCache);
                      }
                    }
                  }
                }
              }
              /*
              // detect pre-launch happening (pre-converting)
              if (currentBlockHeight > 0 && d.result.startblock && d.result.startblock > currentBlockHeight) {
                this.prelaunch[name] = d.result.startblock;
                if (!this.prelaunch[name]) {
                  console.log("prelaunch detected", name, d.result.startblock);
                } else if (d.result.startblock <= currentBlockHeight) {
                  console.log("prelaunch ended", name, d.result.startblock);
                  delete this.prelaunch[name];
                } else {
                  console.log("prelaunch detected", name, "blocks remaining", (d.result.startblock - currentBlockHeight), ", approx", (((d.result.startblock - currentBlockHeight)/1440.0) * 24.0).toFixed(2), "hours remain");
                }
              }
              */
            }
          } else {
            console.error("unknown currency", list[i]);
          }
        }
      }
      return this.currencynames;
    }
    
    async getOffers(currencyid, isCurrency=false, withtx=false, useCache=undefined) {
      let r = undefined;
      let rsp = await this.request("getoffers", [currencyid, isCurrency, withtx], useCache);
      if (rsp && !rsp.error) {
        r = rsp.result;
      }
      return r;
    }
    
    async getAddresses(useCache=undefined) {
      let addresses = {identities:[], public:[], private:[]};
      let rsp = await this.request("getaddressesbyaccount", [""], useCache);
      if (rsp && !rsp.error) {
        for (let a in rsp.result) {
          addresses.public.push(rsp.result[a]);
        }
      } else {
        console.error(rsp);
      }
      rsp = await this.request("listidentities", [], useCache);
      if (rsp && !rsp.error) {
        if (Array.isArray(rsp.result)) {
          for (let a in rsp.result) {
            addresses.identities.push(rsp.result[a].identity.name);
          }
        }
      } else {
        console.error(rsp);
      }
      rsp = await this.request("z_listaddresses", [], useCache);
      if (rsp && !rsp.error) {
        for (let a in rsp.result) {
          addresses.private.push(rsp.result[a]);
        }
      } else {
        console.error(rsp);
      }
      return addresses;
    }

    //***NOTE. this function can take a very long time to return
    async getCurrencyBalance(address, minconf=0, friendlynames=true, useCache=undefined) {
      let balance = undefined;
      let rsp = await this.request("getcurrencybalance", [address, minconf, friendlynames], useCache);
      if (rsp && !rsp.error) {
        balance = rsp.result;
      } else {
        console.error(rsp);
      }
      return balance;
    }

    //***NOTE. this function can take a very long time to return
    async z_getBalance(zaddress, minconf=0, useCache=undefined) {
      let balance = undefined;
      let rsp = await this.request("z_getbalance", [zaddress, minconf], useCache);
      if (rsp && !rsp.error) {
        balance = {"VRSC": rsp.result };
      } else {
        console.error(rsp);
      }
      return balance;
    }

    //***NOTE. this function can take a very long time to return
    async getBalances(minconf=0, useCache=undefined) {
      let totals = {};
      let currencies = [];
      let balances = {};
      let addresses = await this.getAddresses(useCache);
      if (addresses !== undefined) {
        // check listaddressgroupings for any missed R* addresses
        let rsp = await this.request("listaddressgroupings", [], useCache);
        if (rsp && !rsp.error) {
            let groupings = rsp.result;
            for (let i in groupings) {
                for (let z in groupings[i]) {
                    let address = groupings[i][z][0];
                    if (address.startsWith("R") && addresses.public.indexOf(address) < 0) {
                      addresses.public.push(address);
                    }
                }
            }
        } else {
          console.error(rsp);
          return {totals:totals, balances:balances};
        }

        for (let i in addresses.identities) {
          let addr = addresses.identities[i];
          rsp = await this.getCurrencyBalance(addr, minconf);
          if (rsp !== undefined) {
            for (let type in rsp) {
              if (currencies.indexOf(type) < 0) {
                currencies.push(type);
              }
              if (totals[type]) {
                  totals[type] += rsp[type];
              } else {
                  totals[type] = rsp[type];
              }
              if (balances[type] === undefined) {
                  balances[type] = {};
              }
              if (balances[type][addr]) {
                  balances[type][addr] += rsp[type];
              } else {
                  balances[type][addr] = rsp[type];
              }
            }
          }
        }
        
        for (let i in addresses.public) {
          let addr = addresses.public[i];
          rsp = await this.getCurrencyBalance(addr, minconf);
          if (rsp !== undefined) {
            for (let type in rsp) {
              if (currencies.indexOf(type) < 0) {
                currencies.push(type);
              }
              if (totals[type]) {
                  totals[type] += rsp[type];
              } else {
                  totals[type] = rsp[type];
              }
              if (balances[type] === undefined) {
                  balances[type] = {};
              }
              if (balances[type][addr]) {
                  balances[type][addr] += rsp[type];
              } else {
                  balances[type][addr] = rsp[type];
              }
            }
          }
        }
        
        for (let i in addresses.private) {
          // zaddr can only have VRSC
          let type = "VRSC";
          if (currencies.indexOf(type) < 0) {
            currencies.push(type);
          }
          let zaddr = addresses.private[i];
          rsp = await this.request("z_getbalance", [zaddr, minconf], useCache);
          if (rsp && !rsp.error) {
              let balance = rsp.result;
              if (!balance) { balance = 0; }
              if (balance > 0) {
                  if (totals[type]) {
                      totals[type] += balance;
                  } else {
                      totals[type] = balance;
                  }
                  if (balances[type] === undefined) {
                      balances[type] = {};
                  }
                  if (balances[type][zaddr]) {
                      balances[type][zaddr] += balance;
                  } else {
                      balances[type][zaddr] = balance;
                  }
              }
          }
        }
      }

      return {totals:totals, currencies:currencies, balances:balances};
    }
    
};

module.exports = VerusRPC;