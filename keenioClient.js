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

    newExchangeBalance: function (exchangeName, exchangeBalance) {
        var currencies = ['btc', 'eth', 'jpy'],
            balanceArray = [];

        _.each(currencies, function (currency) {
            var amount = exchangeBalance[currency];

            if (!amount) { amount = 0; }

            balanceArray.push({ currency: currency, amount: amount });
        }, this);

        var balance = {
            name: exchangeName,
            balances: balanceArray,
            when: Date.now()
        };

        client.addEvent("balance", balance);

    },

    newTotalBalance: function (balances) {
        var currencies = ['btc', 'eth', 'jpy'],
            data = [];

        _.each(currencies, function (currency) {
            data.push({
                currency: currency,
                amount: balances[currency]
            });
        }, this);

        var totalBalance = {
            balances: data,
            when: Date.now()
        };

        client.addEvent("totalBalance", totalBalance);
    }
};
