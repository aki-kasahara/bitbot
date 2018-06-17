var colors = require('colors'),
  _ = require('underscore'),
  config = require('./../config'),
  utils = require('../utils'),
  crypto = require('crypto'),
  log4js = require('log4js'),
  request = require('request');

log4js.configure('log4js-config.json');
var logger = log4js.getLogger('bitflyer');

module.exports = {

  exchangeName: 'bitflyer',
  host: 'https://api.bitflyer.jp',

  balances: {},

  prices: {},

  emitter: {},

  activeOrders: {},

  balancesMap: {},

  hasOpenOrder: false,

  health: "NORMAL",

  initialize: function (emitter) {
    this.emitter = emitter;
    this.bindEvents();
    this.checkHealth();
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
    var self = this;

    this.balances = {};

    return new Promise((resolve, reject) => {
      //ここにbitflyerの資産残高を取得する処理を実装する
      self.requestPrivateAPI('GET', '/v1/me/getbalance', "undefined", function (error, response, body) {
        if (!error && response.statusCode == 200) {
          var array = JSON.parse(body);
          _.each(array, function (balance, index) {
            self.balances[balance.currency_code.toLowerCase()] = balance.available;
          });

          logger.info('Balance for '.green + self.exchangeName + ' fetched successfully '.green + JSON.stringify(self.balances));

          self.emitter.emit('exchangeBalanceFetched', self.exchangeName);

        } else {
          logger.error('Error when checking balance for '.red + self.exchangeName + " :" + error);
          reject(new Error(JSON.parse(error)));
        }

        resolve(self);
      });
    });
  },

  createOrder: function (market, type, rate, amount) {
    //注文を出す処理を実装する
    var self = this;
    this.hasOpenOrder = true;
    logger.info('Creating order for ' + amount + ' in ' + this.exchangeName + ' in market ' + market + ' to ' + type + ' at rate ' + rate);
    var body = {
      product_code: this.market.name,
      child_order_type: 'LIMIT',
      side: type.toUpperCase(),
      price: rate,
      size: amount
    };
    self.requestPrivateAPI('POST', '/v1/me/sendchildorder', body, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        var json = JSON.parse(body);
        logger.info("bitflyer child_order_acceptance_id " + json.child_order_acceptance_id);
        self.emitter.emit(self.exchangeName + ':orderCreated');
      } else {
        logger.error('bitflyer ORDER UNSUCCESSFULL '.red, body);
        _.delay(function () {
          //self.emitter.emit(self.exchangeName + ':orderNotCreated', market, type, rate, amount);
          self.emitter.emit(self.exchangeName + ':orderCreated');
        }, config.interval);
      }
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
    var market = this.market.name,
      self = this;

    this.prices = {
      buy: {},
      sell: {}
    };

    return new Promise((resolve, reject) => {
      if (this.health === "NORMAL") {
        logger.info('Checking prices for '.yellow + this.exchangeName);

        //板から注文情報を取得する処理を実装する
        var getboard_path = '/v1/getboard?product_code=';
        request(self.host + getboard_path + market, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            var json = JSON.parse(body);
            //2つ目の価格と２つ目までの数量を代入する
            self.prices.sell.price = json.bids[2].price;
            self.prices.sell.quantity = (json.bids[1].size + json.bids[2].size) / 2;

            self.prices.buy.price = json.asks[2].price;
            self.prices.buy.quantity = (json.asks[1].size + json.asks[2].size) / 2;

            logger.info('Exchange prices for ' + self.exchangeName + ' fetched successfully!');
          } else {
            logger.error('error: ' + error);
            reject(JSON.parse(error));
          }
          resolve(self);
        });

      } else {
        logger.info(self.exchangeName + ' Skip to get exchange info. health is ' + this.health);
        resolve(self);
      }
      this.checkHealth();
    });
  },

  //最後に実行されてからconfig.interval/1000秒後にcallback関数呼ばれる
  checkOrderStatus: _.debounce(function () {
    return new Promise((resolve, reject) => {
      var self = this;
      var path = '/v1/me/getchildorders?product_code=' + this.market.name + '&child_order_state=ACTIVE';
      //注文したorderの状況を確認する
      self.requestPrivateAPI('GET', path, "undefined", function (error, response, body) {
        if (!error && response.statusCode == 200) {
          var json = JSON.parse(body);
          if (_.isEmpty(json)) {
            logger.info('order for '.green + self.exchangeName + ' filled successfully!'.green);
            _.delay(function () {
              self.hasOpenOrder = false;
              self.emitter.emit(self.exchangeName + ':orderMatched');
            }, config.interval);
          } else {
            logger.info('order for '.red + self.exchangeName + ' not filled yet!'.red + JSON.stringify(json));
            _.delay(function () {
              self.activeOrders = {
                child_order_id: json[0].child_order_id,
                type: json[0].side,
                rate: json[0].price,
                amount: json[0].outstanding_size
              };
              self.emitter.emit(self.exchangeName + ':orderNotMatched');
            }, config.interval);
          }
        } else {
          logger.error('bitflyer checkOrderStatus UNSUCCESSFULL '.red, error);
          self.emitter.emit(self.exchangeName + ':orderNotMatched');
          reject(JSON.parse(error));
        }

        resolve(self);
      });
    });
  }, config.interval),

  requestPrivateAPI: function (method, path, body, callback) {
    var self = this;
    var timestamp = Date.now().toString();
    var text = timestamp + method + path;
    if (method === "POST") {
      text = text + JSON.stringify(body);
    }

    var signed_text = crypto.createHmac('sha256', config.bitflyer.secret).update(text).digest('hex');
    var options = {
      url: self.host + path,
      method: method,
      headers: {
        'ACCESS-KEY': config.bitflyer.apiKey,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-SIGN': signed_text,
        'Content-Type': 'application/json'
      }
    };

    if (method === "POST") {
      options.body = JSON.stringify(body);
    }

    request(options, callback);
  },

  executeLossCut: function () {
    return new Promise((resolve, reject) => {
      var self = this;
      var path = '/v1/me/cancelallchildorders';
      //注文をキャンセルする
      var body = {
        "product_code": self.market.name
      };
      logger.info('bitflyer cancel childorder:' + JSON.stringify(self.activeOrders));
      self.requestPrivateAPI('POST', path, body, function (error, response, body) {
        if (!error && response.statusCode == 200) {
          logger.info('bitflyer cancelchildorder SUCCESSFULL '.green);
          if (self.activeOrders.amount > self.market.minAmount) {
            var rate;
            if (self.activeOrders.type === "BUY") {
              rate = parseInt(self.activeOrders.rate) + 4000;
            } else if (self.activeOrders.type === "SELL") {
              rate = parseInt(self.activeOrders.rate) - 4000;
            }
            self.createOrder(config.market, self.activeOrders.type, rate, self.activeOrders.amount);
          } else {
            self.emitter.emit(self.exchangeName + ':orderCreated');
          }

        } else {
          logger.error('bitflyer cancelchildorder UNSUCCESSFULL '.red, error);
          self.emitter.emit(self.exchangeName + ':orderCreated');
          reject(JSON.parse(error));
        }

        resolve(self);
      });
    });
  },

  checkHealth: function () {
    return new Promise((resolve, reject) => {
      var self = this;
      const date = new Date();
      const maintainance_date = new Date('2018-03-01T04:05:00');
      const diff = Math.abs(self.toMinute(maintainance_date) - self.toMinute(date));
      var gethealth_path = '/v1/gethealth';

      if (diff <= 10) {
        self.health = 'MAINTAINANCE';
      } else {
        request(self.host + gethealth_path, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            var json = JSON.parse(body);
            self.health = json.status;
          } else {
            logger.error('error: ' + error);
            reject(JSON.parse(error));
          }
          resolve(self);
        });
      }
    });
  },

  toMinute: function (date) {
    return date.getHours() * 60 + date.getMinutes();
  }

};
