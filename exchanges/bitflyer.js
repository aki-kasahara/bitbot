var colors          = require('colors'),
    _               = require('underscore'),
    Deferred        = require("promised-io/promise").Deferred,
    config          = require('./../config'),
    utils           = require('../utils'),
    request           = require('request');
    //BitflyerClient    = require('bitflyer-client');

//var bitflyer = new BitfleyrClient(config['bitflyer'].apiKey, config['bitflyer'].secret);

module.exports = {

    exchangeName: 'bitflyer',

    balances: {},

    prices: {},

    emitter: {},

    balancesMap: {},

    hasOpenOrder: false,

    initialize: function (emitter) {
        this.emitter = emitter;
        this.bindEvents();
    },

    bindEvents: function () {
        _.bindAll(this, 'checkOrderStatus', 'fetchBalance', 'createOrder');
        this.emitter.on(this.exchangeName + ':orderNotMatched', this.checkOrderStatus);
        this.emitter.on(this.exchangeName + ':orderMatched', this.fetchBalance);
        this.emitter.on(this.exchangeName + ':orderCreated', this.checkOrderStatus);
        this.emitter.on(this.exchangeName + ':orderNotCreated', this.createOrder);
    },

    setMarket: function (market) {
        this.market = config[this.exchangeName].marketMap[market];
    },

    fetchBalance: function () {
        var deferred = new Deferred(),
            self = this;

        this.balances = {};

        //TODO
        //ここにbitflyerの資産残高を取得する処理を実装する

        setTimeout(function () {
            try { deferred.resolve();} catch (e){}
        }, config.requestTimeouts.balance);

        return deferred.promise;
    },

    createOrder: function (market, type, rate, amount) {
        //TODO
        //注文を出す処理を実装する
    },

    calculateProfit: function (amount, decimals) {
        var sellFee = config[this.exchangeName].fees[config.market].sell;
        return utils.calculateProfit(amount, this.prices.sell.price, sellFee.currency, sellFee.percentage, decimals);
    },

    calculateCost: function (amount, decimals) {
        var buyFee = config[this.exchangeName].fees[config.market].buy;
        return utils.calculateCost(amount, this.prices.buy.price, buyFee.currency, buyFee.percentage, decimals);
    },

    getExchangeInfo: function () {
        var deferred = new Deferred(),
            market = this.market.name,
            self = this;

        this.prices = {
            buy: {},
            sell : {}
        };

        console.log('Checking prices for '.yellow + this.exchangeName);

        //TODO
        //板から注文情報を取得する処理を実装する
        var host = 'https://api.bitflyer.jp';
        var getboard_path = '/v1/getboard?product_code=';
        request(host + getboard_path + market, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            self.prices.buy.price=json.bids[0].price;
            self.prices.buy.quantity=json.bids[0].size;
            self.prices.sell.price=json.asks[0].price;
            self.prices.sell.quantity=json.asks[0].size;
            console.log('Exchange prices for ' + self.exchangeName + ' fetched successfully!');
            deferred.resolve(self);
          } else {
            console.log('error: ' + error);

          }
        });

        // setTimeout(function () {
        //     try {deferred.resolve();} catch (e){}
        // }, config.requestTimeouts.prices);

        return deferred.promise;
    },

    //最後に実行されてからconfig.interval/1000秒後にcallback関数呼ばれる
    checkOrderStatus: _.debounce(function () {
        var self = this;

        //TODO
        //注文したorderの状況を確認する
    }, config.interval)
};
