module.exports = {
  bitflyer: {
    apiKey: "aaa",
    secret: "bbb",
    decimals: 4,
    marketMap : {
      ETH_BTC : {
          name : "ETH_BTC",
          minAmount:0.001
      },
      BTC_JPY : {
          name : "BTC_JPY",
          minAmount:0.001
      }
    },
    fees:{
      ETH_BTC:{
        buy:{
          currency:"BTC",
          percentage:0.002
        },
        sell:{
          currency:"BTC",
          percentage:0.002
        }
      },
      BTC_JPY:{
        buy:{
          currency:"JPY",
          percentage:0.0015
        },
        sell:{
          currency:"JPY",
          percentage:0.0015
        }
      }
    }
  },

  coincheck: {
    apiKey: "ccc",
    secret: "ddd",
    decimals: 4,
    marketMap : {
      BTC_JPY : {
          name : "BTC_JPY",
          minAmount:0.005
      }
    },
    fees:{
      BTC_JPY:{
        buy:{
          currency:"JPY",
          percentage:0.0
        },
        sell:{
          currency:"JPY",
          percentage:0.0
        }
      }
    }
  },

  keenio:{
    projectId: "ddd",
    writeKey: "eee",
    readKey : "fff"
  },

  requestTimeouts : {
    balance : 1000,
    prices : 1000
  },

  interval : 4000,
  tradeAmount:0.01,
  counter : undefined
};
