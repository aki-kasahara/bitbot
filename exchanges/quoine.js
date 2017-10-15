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

        self.requestPrivateAPI('GET', '/accounts/balance', "undefined", function(error, response, body){
          if (response.statusCode == 200){
            var json = JSON.parse(body);
            var jpy = _.find(json, function(num){
              return num.currency === "JPY";
            });
            var btc = _.find(json, function(num){
              return num.currency === "BTC";
            });
            self.balances.jpy = parseFloat(jpy.balance);
            self.balances.btc = parseFloat(btc.balance);

            logger.info('Balance for '.green + self.exchangeName + ' fetched successfully '.green + JSON.stringify(self.balances));

            self.emitter.emit('exchangeBalanceFetched', self.exchangeName);

          } else {
            logger.error('Error when checking balance for '.red + self.exchangeName + " :" + body.error);
          }

          deferred.resolve(self);
        });

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
          order_type : "limit",
          product_id : self.balancesMap[this.market.name],
          side : type,
          quantity : amount,
          price : rate
        }
        self.requestPrivateAPI('POST', '/orders', body, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            logger.info("quoine order id " + json.id);
            self.emitter.emit(self.exchangeName + ':orderCreated');
          } else {
            logger.error('quoine ORDER UNSUCCESSFULL '.red, body);
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
        var path = '/orders?status=live';
        //注文したorderの状況を確認する
        self.requestPrivateAPI('GET', path, "undefined", function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            if (_.isEmpty(json.models)){
              logger.info('order for '.green + self.exchangeName + ' filled successfully!'.green);
              _.delay(function () {
                  self.hasOpenOrder = false;
                  self.emitter.emit(self.exchangeName + ':orderMatched');
              }, config.interval);
            } else {
              logger.info('order for '.red + self.exchangeName + ' not filled yet!'.red);
              _.delay(function () {
                  self.activeOrders = {
                    id : json.models[0].id,
                    side : json.models[0].side,
                    price : json.models[0].price,
                    quantity : parseFloat(json.models[0].quantity)
                  };
                  self.emitter.emit(self.exchangeName + ':orderNotMatched');
              }, config.interval);
            }
          } else {
            logger.error('quoine checkOrderStatus UNSUCCESSFULL '.red, error);
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

      if (method==="POST" && method==="PUT"){
        options.body = JSON.stringify(body);
      }

      request(options, callback);
    },

    executeLossCut: function(){
      var deferred = new Deferred();
      var self = this;
      var path = '/orders/' + self.activeOrders.id;
      //注文を編集する
      logger.info('quoine edit order:' + JSON.stringify(self.activeOrders));
      var price;
      if (self.activeOrders.side==="buy"){
        price = parseInt(self.activeOrders.price) + 4000;
      } else if (self.activeOrders.side==="sell"){
        price = parseInt(self.activeOrders.price) - 4000;
      }
      var body = {
        price : price
      };
      self.requestPrivateAPI('PUT', path, body, function(error, response, body){
        var json = JSON.parse(body);
        if (!error && response.statusCode == 200){
          logger.info('quoine edit order SUCCESSFULL '.green);
        } else {
          logger.error('quoine edit order UNSUCCESSFULL '.red, error);
        }
        self.emitter.emit(self.exchangeName + ':orderCreated');
        deferred.resolve(self);
      });
      return deferred.promise;
    }

};
