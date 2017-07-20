var Keen        = require('keen-js'),
    config      = require('./config'),
    _           = require('underscore');

var client = new Keen({
  projectId: config.keenio.projectId,
  writeKey:  config.keenio.writeKey,
  readKey:   config.keenio.readKey
});

module.exports = {
    initialize: function () {
      console.log("Keenio client is created");
    },

    registerNewTrade: function (tradeData) {

        var trade = {
            market: tradeData.market,
            exchange1: {
                name: tradeData.ex1.name,
                buyPrice: tradeData.ex1.buyPrice,
                amount: tradeData.ex1.amount
            },
            exchange2: {
                name: tradeData.ex2.name,
                sellPrice: tradeData.ex2.sellPrice,
                amount: tradeData.ex2.amount
            },
            profit: tradeData.finalProfit,
            when: Date.now()
        };

        client.addEvent("trade", trade);
    },

    registerTradeForInsufficientBalance: function (tradeData) {

        var trade = {
            market: tradeData.market,
            exchange1: {
                name: tradeData.ex1.name,
                buyPrice: tradeData.ex1.buyPrice,
                amount: tradeData.ex1.amount
            },
            exchange2: {
                name: tradeData.ex2.name,
                sellPrice: tradeData.ex2.sellPrice,
                amount: tradeData.ex2.amount
            },
            profit: tradeData.finalProfit,
            when: Date.now()
        };

        client.addEvent("unavailableTrade", trade);
    },

    newExchangeBalance: function (exchangeName, exchangeBalance) {
        var balance = {
            name: exchangeName,
            balances: exchangeBalance
        };

        client.addEvent("exchangeBalance", balance);

    },

    newTotalBalance: function (balances) {
        client.addEvent("allBalance", balances);
    }
};
