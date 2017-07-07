var colors          = require('colors'),
    _               = require('underscore'),
    Deferred        = require("promised-io/promise").Deferred,
    config          = require('./../config'),
    utils           = require('../utils'),
    crypto          = require('crypto'),
    request           = require('request');
    //BitflyerClient    = require('bitflyer-client');

//var bitflyer = new BitfleyrClient(config['bitflyer'].apiKey, config['bitflyer'].secret);

module.exports = {

    exchangeName: 'bitflyer',
    host: 'https://api.bitflyer.jp',

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

        //ここにbitflyerの資産残高を取得する処理を実装する
        self.requestPrivateAPI('GET', '/v1/me/getbalance', "undefined", function(error, response, body){
          if (!error && response.statusCode == 200){
            var array = JSON.parse(body);
            _.each(array, function(balance, index){
              self.balances[balance.currency_code.toLowerCase()] = balance.available;
            });

            console.log('Balance for '.green + self.exchangeName + ' fetched successfully '.green + JSON.stringify(self.balances));

            self.emitter.emit('exchangeBalanceFetched', self.exchangeName);

          } else {
            console.log('error: ' + error);
            console.log('Error when checking balance for '.red + self.exchangeName);
          }

          deferred.resolve(self);
        });

        // setTimeout(function () {
        //     try { deferred.resolve();} catch (e){}
        // }, config.requestTimeouts.balance);

        return deferred.promise;
    },

    createOrder: function (market, type, rate, amount) {
        //注文を出す処理を実装する
        var self = this;
        this.hasOpenOrder = true;
        console.log('Creating order for ' + amount + ' in ' + this.exchangeName + ' in market ' + market + ' to ' + type + ' at rate ' + rate);
        var body = {
          product_code : this.market.name,
          child_order_type : 'LIMIT',
          side : type.toUpperCase(),
          price : rate,
          size : amount
        };
        self.requestPrivateAPI('POST', '/v1/me/sendchildorder', body, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            console.log("bitflyer child_order_acceptance_id " + json.child_order_acceptance_id);
            self.emitter.emit(self.exchangeName + ':orderCreated');
          } else {
            console.log('bitflyer ORDER UNSUCCESSFULL '.red, body);
            _.delay(function () {
                self.emitter.emit(self.exchangeName + ':orderNotCreated', market, type, rate, amount);
            }, config.interval);
          }

          //deferred.resolve(self);
        });
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

        //板から注文情報を取得する処理を実装する
        var getboard_path = '/v1/getboard?product_code=';
        request(self.host + getboard_path + market, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            //2つ目の価格と２つ目までの数量を代入する
            self.prices.buy.price=json.bids[1].price;
            self.prices.buy.quantity=json.bids[0].size + json.bids[1].size;
            self.prices.sell.price=json.asks[1].price;
            self.prices.sell.quantity=json.asks[0].size + json.asks[1].size;
            console.log('Exchange prices for ' + self.exchangeName + ' fetched successfully!');
          } else {
            console.log('error: ' + error);
          }
          try {deferred.resolve(self);} catch (e){}
        });

        // setTimeout(function () {
        //     try {deferred.resolve();} catch (e){}
        // }, config.requestTimeouts.prices);

        return deferred.promise;
    },

    //最後に実行されてからconfig.interval/1000秒後にcallback関数呼ばれる
    checkOrderStatus: _.debounce(function () {
        var deferred = new Deferred();
        var self = this;
        var path = '/v1/me/getchildorders?product_code=' + this.market.name +'&child_order_state=ACTIVE';
        //注文したorderの状況を確認する
        self.requestPrivateAPI('GET', path, "undefined", function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            if (_.isEmpty(json)){
              console.log('order for '.green + self.exchangeName + ' filled successfully!'.green);
              _.delay(function () {
                  self.hasOpenOrder = false;
                  self.emitter.emit(self.exchangeName + ':orderMatched');
              }, config.interval);
            } else {
              console.log('order for '.red + self.exchangeName + ' not filled yet!'.red);
              self.emitter.emit(self.exchangeName + ':orderNotMatched');
            }
          } else {
            console.log('bitflyer checkOrderStatus UNSUCCESSFULL '.red, error);
            self.emitter.emit(self.exchangeName + ':orderNotMatched');
          }

          deferred.resolve(self);
        });
        return deferred.promise;
    }, config.interval),

    requestPrivateAPI: function(method, path, body, callback){
      var self = this;
      var timestamp = Date.now().toString();
      var text = timestamp + method + path;
      if (method==="POST"){
        text = text + JSON.stringify(body);
      }

      var signed_text = crypto.createHmac('sha256', config.bitflyer.secret).update(text).digest('hex');
      var options = {
        url: self.host + path,
        method : method,
        headers: {
            'ACCESS-KEY': config.bitflyer.apiKey,
            'ACCESS-TIMESTAMP': timestamp,
            'ACCESS-SIGN': signed_text,
            'Content-Type': 'application/json'
        }
      };

      if (method==="POST"){
        options.body = JSON.stringify(body);
      }

      request(options, callback);
    }

};
