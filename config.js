module.exports = {
  kraken: {
    apiKey: "aaa",
    secret: "bbb",
    marketMap : {
      BTC_USD : {
          name : "XXBTZUSD"
      }
    }
  },

  bitfinex: {
    apiKey: "aaa",
    secret: "bbb",
    marketMap : {
      BTC_USD: {
        name : "btcusd"
      }
    }
  },

  requestTimeouts : {
    balance : 10
  },

  interval : 5000
};
