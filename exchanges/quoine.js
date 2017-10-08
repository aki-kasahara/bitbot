var colors          = require('colors'),
    _               = require('underscore'),
    Deferred        = require("promised-io/promise").Deferred,
    config          = require('./../config'),
    utils           = require('../utils'),
    log4js          = require('log4js'),
    jwt             = require('jsonwebtoken'),
    request         = require('request');

    log4js.configure('log4js-config.json');
    var logger = log4js.getLogger('quoine');

module.exports = {

    exchangeName: 'quoine',
    host: 'https://api.quoine.com',

    balances: {},

    prices: {},

    emitter: {},

    activeOrders:{},

    balancesMap: {
      "BTC_JPY": 5,
      "ETH_BTC": 37
    },

    hasOpenOrder: false,

    initialize: function (emitter) {
        this.emitter = emitter;
        this.bindEvents();
    },

    bindEvents: function () {
        _.bindAll(this, 'checkOrderStatus', 'fetchBalance', 'createOrder', 'executeLossCut');
        //this.emitter.on(this.exchangeName + ':orderNotMatched', this.checkOrderStatus);
        this.emitter.on(this.exchangeName + ':orderNotMatched', this.executeLossCut);
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

        // self.requestPrivateAPI('GET', '/api/accounts/balance', "undefined", function(error, response, body){
        //   if (response.statusCode == 200){
        //     var json = JSON.parse(body);
        //     self.balances.jpy = parseFloat(json.jpy) - parseFloat(json.jpy_reserved);
        //     self.balances.btc = parseFloat(json.btc) - parseFloat(json.btc_reserved);
        //
        //     logger.info('Balance for '.green + self.exchangeName + ' fetched successfully '.green + JSON.stringify(self.balances));
        //
        //     self.emitter.emit('exchangeBalanceFetched', self.exchangeName);
        //
        //   } else {
        //     logger.error('Error when checking balance for '.red + self.exchangeName + " :" + body.error);
        //   }
        //
        //   deferred.resolve(self);
        // });

        setTimeout(function () {
            try {
              deferred.resolve();
            } catch (e){

            }
        }, config.requestTimeouts.balance);

        return deferred.promise;
    },

    createOrder: function (market, type, rate, amount) {
        //注文を出す処理を実装する
        var self = this;
        this.hasOpenOrder = true;
        logger.info('Creating order for ' + amount + ' in ' + this.exchangeName + ' in market ' + market + ' to ' + type + ' at rate ' + rate);
        var body = {
          pair : this.market.name.toLowerCase(),
          order_type : type,
          rate : rate,
          amount : amount
        };
        self.requestPrivateAPI('POST', '/api/exchange/orders', body, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            logger.info("coincheck order id " + json.id);
            self.emitter.emit(self.exchangeName + ':orderCreated');
          } else {
            logger.error('coincheck ORDER UNSUCCESSFULL '.red, body);
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

        logger.info('Checking prices for '.yellow + this.exchangeName);

        //板から注文情報を取得する処理を実装する
        request(self.host + '/products/' + self.balancesMap[market] + '/price_levels', function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            //sell.price - buy.priceが負になるように入れる
            //1つ目の価格と1つ目までの数量を代入する
            self.prices.sell.price = parseFloat(json.buy_price_levels[2][0]);
            self.prices.sell.quantity = (parseFloat(json.buy_price_levels[1][1]) + parseFloat(json.buy_price_levels[2][1]))/2;

            self.prices.buy.price = parseFloat(json.sell_price_levels[2][0]);
            self.prices.buy.quantity = (parseFloat(json.sell_price_levels[1][1]) + parseFloat(json.sell_price_levels[2][1]))/2;

            logger.info('Exchange prices for ' + self.exchangeName + ' fetched successfully!');
          } else {
            logger.error('error: ' + error);
          }
          try {deferred.resolve(self);} catch (e){}
        });

        setTimeout(function () {
            try {
              deferred.resolve();
            } catch (e){

            }
        }, config.requestTimeouts.prices);

        return deferred.promise;
    },

    //最後に実行されてからconfig.interval/1000秒後にcallback関数呼ばれる
    checkOrderStatus: _.debounce(function () {
        var deferred = new Deferred();
        var self = this;
        var path = '/api/exchange/orders/opens';
        //注文したorderの状況を確認する
        self.requestPrivateAPI('GET', path, "undefined", function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            if (_.isEmpty(json.orders)){
              logger.info('order for '.green + self.exchangeName + ' filled successfully!'.green);
              _.delay(function () {
                  self.hasOpenOrder = false;
                  self.emitter.emit(self.exchangeName + ':orderMatched');
              }, config.interval);
            } else {
              logger.info('order for '.red + self.exchangeName + ' not filled yet!'.red);
              _.delay(function () {
                  self.activeOrders = {
                    id : json.orders[0].id,
                    type : json.orders[0].order_type,
                    rate : json.orders[0].rate,
                    amount : parseFloat(json.orders[0].pending_amount)
                  };
                  self.emitter.emit(self.exchangeName + ':orderNotMatched');
              }, config.interval);
            }
          } else {
            logger.error('coincheck checkOrderStatus UNSUCCESSFULL '.red, error);
            self.emitter.emit(self.exchangeName + ':orderNotMatched');
          }

          deferred.resolve(self);
        });
        return deferred.promise;
    }, config.interval),

    requestPrivateAPI: function(method, path, body, callback){
      var self = this;
      var timestamp = new Date().getTime();
      var payload = {
        path: path,
        nonce: timestamp,
        token_id: config.quoine.token_id
      };
      var signature = jwt.sign(payload, config.quoine.secret);
      var options = {
        url: self.host + path,
        method : method,
        headers: {
          'X-Quoine-API-Version': '2',
          'X-Quoine-Auth': signature,
          'Content-Type': 'application/json'
        }
      };

      if (method==="POST"){
        options.body = JSON.stringify(body);
      }

      request(options, callback);
    },

    executeLossCut: function(){
      var deferred = new Deferred();
      var self = this;
      var path = '/api/exchange/orders/' + self.activeOrders.id;
      //注文をキャンセルする
      logger.info('coincheck cancel order:' + JSON.stringify(self.activeOrders));
      self.requestPrivateAPI('DELETE', path, "undefied", function(error, response, body){
        var json = JSON.parse(body);
        if (!error && response.statusCode == 200 && json.success){
          logger.info('coincheck cancel order SUCCESSFULL '.green);
          if (self.activeOrders.amount > self.market.minAmount){
            var rate;
            if (self.activeOrders.type==="buy"){
              rate = parseInt(self.activeOrders.rate) + 4000;
            } else if (self.activeOrders.type==="sell"){
              rate = parseInt(self.activeOrders.rate) - 4000;
            }
            self.createOrder(config.market, self.activeOrders.type, rate, self.activeOrders.amount);
          } else {
            self.emitter.emit(self.exchangeName + ':orderCreated');
          }

        } else {
          logger.error('coincheck cancel order UNSUCCESSFULL '.red, error);
          self.emitter.emit(self.exchangeName + ':orderCreated');
        }

        deferred.resolve(self);
      });
      return deferred.promise;
    }

};
