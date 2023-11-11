const express = require('express');
const router = express.Router();

const bp = require('body-parser');  
const jsonParser = bp.json();
const urlencodedParser = bp.urlencoded({ extended: false });

var config = undefined;
var rpc = undefined;

async function init(vconfig, vrpc)
{
  config = vconfig;
  rpc = vrpc;
}

async function unsafeRpcGET(req, res) {
    if (req.params.method) {
        
        console.log("WARN, dev rpc method:", req.params.method);
        let params = [];
        if (req.params.params) {
          console.log("WARN, dev rpc params:", req.params.params);
          params.push(req.params.params);
        }
        
        let result = await rpc.request(req.params.method, params, false);
        if (result != undefined) {
            if (req.params.method != "help") {
              res.status(200).type('application/json').send(result);
            } else {
              res.status(200).type('text/plain').send(result.result);
            }
        } else {
            res.status(500).type('application/json').send({error: 500});
        }
    } else {
        res.status(400).type('application/json').send({error: 500});
    }
}

async function unsafeRpcPOST(req, res) {
    if (req.params.method) {
        var bodyParser = require('body-parser');
        
        console.log("WARN, dev rpc method:", req.params.method, req.body);
        
        let result = await rpc.request(req.params.method, req.body, false);
        if (result != undefined) {
            res.status(200).type('application/json').send(result);
        } else {
            res.status(500).type('application/json').send({error: 500});
        }
    } else {
        res.status(400).type('application/json').send({error: 500});
    }
}


// API helpers

async function getConversionsList(req,res) {
  let result = rpc.get_conversions();
  res.status(200).type('application/json').send(result);
}
async function getConversionResult(req,res) {
  let result = rpc.get_conversion_by_uid(req.params.uid);
  if (result != undefined) {
      res.status(200).type('application/json').send(result);
  } else {
      let result = rpc.get_conversion_by_txid(req.params.uid);
      if (result != undefined) {
        res.status(200).type('application/json').send(result);
      } else {
        res.status(500).type('application/json').send({error: 500});
      }
  }
}
async function clearConversionResult(req,res) {
  let result = rpc.remove_conversion(req.params.uid);
  if (result === true) {
      res.status(200).type('application/json').send(true);
  } else {
    let result = rpc.remove_conversion_by_txid(req.params.uid);
    if (result === true) {
      res.status(200).type('application/json').send(true);
    } else {
      res.status(500).type('application/json').send({error: 500});
    }
  }
}
async function getOperationResult(req,res) {
    let result = await rpc.getOperationResult(req.params.opid, false);
    if (result != undefined) {
        res.status(200).type('application/json').send(result);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}

async function clearOperationResult(req,res) {
    let result = await rpc.getOperationResult(req.params.opid, false);
    if (result != undefined) {
        res.status(200).type('application/json').send(true);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}

async function getAddresses(req,res) {
    let result = await rpc.getAddresses();
    if (result != undefined) {
        res.status(200).type('application/json').send(result);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}

async function getBalances(req,res) {  
    let result = await rpc.getBalances();
    if (result != undefined) {
        res.status(200).type('application/json').send(result);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}

async function getBalance(req,res) {  
    let result;
    if (req.params.address.indexOf("zs1") < 0) {
      result = await rpc.getCurrencyBalance(req.params.address);
    } else {
      result = await rpc.z_getBalance(req.params.address);
    }
    if (result != undefined) {
        res.status(200).type('application/json').send(result);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}

async function getBlockReward(req,res) {
    let result = await rpc.getNextBlockReward();
    if (result != undefined) {
        res.status(200).type('application/json').send(result);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}

async function getCurrencies(req,res) {
  res.status(200).type('application/json').send(rpc.currencies);
}

async function getCurrency(req,res) {
  let currency = await rpc.getCurrency(req.params.currency, true);
  if (currency != undefined) {
    res.status(200).type('application/json').send(currency);
  } else {
      res.status(500).type('application/json').send({error: 500});
  }
}

async function getInfo(req,res) {
    let result = await rpc.getInfo();
    if (result != undefined) {
        res.status(200).type('application/json').send(result);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}

async function getMiningInfo(req,res) {
    let result = await rpc.getMiningInfo();
    if (result != undefined) {
        res.status(200).type('application/json').send(result);
    } else {
        res.status(500).type('application/json').send({error: 500});
    }
}



// HTML helpers

async function renderHome(req,res) {
  const tvar = await rpc.getTemplateVars(true);
  if (tvar != undefined) {
    res.render('home', {
        title: 'Home',
        vars: tvar
    })
  } else {
      res.status(500).type('application/json').send({error: 500});
  }
}

async function renderViewCurrency(req,res) {
  const tvar = await rpc.getTemplateVars(true);
  const currency = await rpc.getCurrency(req.params.currency, true);
  if (tvar != undefined) {
    res.render('viewcurrency', {
        title: 'View Currency',
        vars: tvar,
        currency: currency
    })
  } else {
      res.status(500).type('application/json').send({error: 500});
  }
}

async function renderReceive(req,res) {
  const tvar = await rpc.getTemplateVars(true);
  if (tvar != undefined) {
    res.render('receive', {
        title: 'Receive',
        vars: tvar
    })
  } else {
      res.status(500).type('application/json').send({error: 500});
  }
}

async function renderSendCurrency(req,res) {
  const tvar = await rpc.getTemplateVars(true);
  if (tvar != undefined) {
    res.render('send', {
      title: 'Send Currency',
      vars: tvar
    })
  } else {
      res.status(500).type('application/json').send({error: 500});
  }
}

async function renderConvertCurrency(req,res) {
  const tvar = await rpc.getTemplateVars(true);
  
  let rconversion = undefined;
  let reverse_uid = undefined;
  if (req.params.uid) {
    rconversion = await rpc.get_conversion_by_uid(req.params.uid, true);
  }
  if (tvar != undefined) {
    res.render('convert', {
      title: 'Convert Currency',
      vars: tvar,
      reverse_convert: rconversion
    })
  } else {
      res.status(500).type('application/json').send({error: 500});
  }
}

async function handleSendCurrency(req,res) {
    let minconf = 1; // sanitize to integer
    if (req.body.minconf) { try { minconf = parseInt(req.body.minconf); } catch { minconf = 1; } }

    let fee = undefined; // sanitize to Number
    if (req.body.fee) { try { fee = Number(req.body.fee); } catch { fee = undefined; } }

    // build "params" for sendCurrency
    let params = [];
    let invalid = [];
    let estimates = [];

    // support up to 100 'tousers' on send currency
    for (let i=0; i<100; i++)
    {
      let toAddress = req.body["toAddress" + i];
      if (!toAddress) {
        break;
      }
      
      let amount = req.body["amount" + i];
      let currency = req.body["currency" + i];
      let convertto = req.body["convertto" + i];
      let via = req.body["via" + i];

      // sanitize to Number
      try { amount = Number(amount); } catch { amount = 0; }
      if (Number.isNaN(amount) || amount < 0) {
        amount = 0;
      }

      // TODO handle other options
      //let addconversionfees
      //let exportto
      //let exportid
      //let exportcurrency
      //let feecurrency
      //let refundto
      //let burn
      //let mintnew
      //let preconvert

      // ignore empty entries
      if (toAddress) {
        // subtract fee from first amount only
        if (i == 0) {
          if (amount && amount > 0 && fee && fee > 0 && (req.body.subtractfee === true || req.body.subtractfee === "true")) {
              amount = (amount - fee);
          }
        }
        let param = {
          address:toAddress,
          amount:amount,
          currency:currency
        };
        let needsEstimate = false;
        if (convertto && convertto != " ") {
          if (convertto != currency && convertto != via) {
            param.convertto = convertto;
            needsEstimate = true;
          } else {
            // invalid convertto
            invalid.push("convertto"+i);
          }
        }
        if (via && via != " ") {
          if (via != currency && via != convertto) {
            param.via = via;
            needsEstimate = true;
          } else {
            // invalid convert via
            invalid.push("via"+i);
          }
        }
        if (needsEstimate) {
          let estimate = await rpc.estimateConversion(param.amount, param.currency, param.convertto, param.via, false);
          if (estimate && estimate.estimatedcurrencyout) {
            estimates.push(estimate.estimatedcurrencyout);
          } else {
            invalid.push("currency"+i);
            invalid.push("convertto"+i);
            invalid.push("via"+i);
            estimates.push(0.0);
          }
        }
        params.push(param);
      }
    }

    // if we have invalid entries
    if (invalid.length > 0) {
      let result = { invalid: invalid, estimates: estimates };
      res.status(500).type('application/json').send(result);
      return;
    }
    
    // if user has not verified generated rpc command
    let verifyFirst = (req.body.verified !== true && req.body.verified !== "true");

    // perform rpc request
    if (params.length > 0) {
      let result = await rpc.sendCurrency(req.body.fromAddress, params, minconf, fee, verifyFirst);
      if (result) {
        result.estimates = estimates;
      }
      if (result.opid || result.verify === true) {
        res.status(200).type('application/json').send(result);
      } else if (result.invalid) {
        res.status(200).type('application/json').send(result);
      } else {
        res.status(500).type('application/json').send(result);
      }
    } else {
      let result = { invalid: ["toAddress0"] };
      res.status(500).type('application/json').send(result);
    }
}

// middleware that is specific to this router
router.use((req, res, next) => {
    //console.log('(api_router) Time: ', Date.now())
    next()
})



// HOME page
router.get('/', (req, res) => {
    renderHome(req, res);
})
router.get('/view/:currency', (req, res) => {
    renderViewCurrency(req, res);
})


// WALLET pages

router.get('/receive', (req, res) => {
    renderReceive(req, res);
})

router.get('/send', (req, res) => {
  renderSendCurrency(req, res);
})

router.post('/send', urlencodedParser, (req, res) => {
  handleSendCurrency(req, res);
})

router.get('/convert/reverse/:uid', (req, res) => {
  renderConvertCurrency(req, res);
})
router.get('/convert', (req, res) => {
  renderConvertCurrency(req, res);
})
router.post('/convert', urlencodedParser, (req, res) => {
  handleSendCurrency(req, res);
})


// API
router.get('/api/conversions', (req, res) => {
    getConversionsList(req, res);
});
router.get('/api/conversion/result/:uid', (req, res) => {
    getConversionResult(req, res);
});
router.get('/api/conversion/clear/:uid', (req, res) => {
    clearConversionResult(req, res);
});
router.get('/api/opid/result/:opid', (req, res) => {
    getOperationResult(req, res);
});
router.get('/api/opid/clear/:opid', (req, res) => {
    clearOperationResult(req, res);
});

router.get('/api/addresses', (req, res) => {
    getAddresses(req, res);
});
router.get('/api/balances', (req, res) => {
    getBalances(req, res);
});
router.get('/api/balance/:address', (req, res) => {
    getBalance(req, res);
});
router.get('/api/blockreward', (req, res) => {
    getBlockReward(req, res);
});
router.get('/api/currencies', (req, res) => {
    getCurrencies(req, res);
});
router.get('/api/currency/:currency', (req, res) => {
    getCurrency(req, res);
});
router.get('/api/info', (req, res) => {
    getInfo(req, res);
});
router.get('/api/mininginfo', (req, res) => {
    getMiningInfo(req, res);
});
router.get('/api/tickers', (req, res) => {
    res.status(200).type('application/json').send(rpc.tickers);
});



// DIRECT RPC (Dev Only, temp for testing)

router.get('/rpc/:method', (req, res) => {
    unsafeRpcGET(req, res);
});
router.get('/rpc/:method/:params', (req, res) => {
    unsafeRpcGET(req, res);
});
router.post('/rpc/:method', urlencodedParser, (req, res) => {
    unsafeRpcPOST(req, res);
});


router.init = init
module.exports = router