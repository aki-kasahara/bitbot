const colors = require('colors');
const _ = require('underscore');
const crypto = require('crypto');
const log4js = require('log4js');
const request = require('request');
const config = require('./../config');
const utils = require('../utils');

log4js.configure('log4js-config.json');
const logger = log4js.getLogger('bitflyer');

module.exports = {

  exchangeName: 'bitflyer',
  host: 'https://api.bitflyer.jp',

  balances: {},

  prices: {},

  emitter: {},

  activeOrders: {},

  balancesMap: {},

  hasOpenOrder: false,

  health: 'NORMAL',

  initialize(emitter) {
    this.emitter = emitter;
    this.bindEvents();
    this.checkHealth();
  },

  bindEvents() {
    _.bindAll(this, 'checkOrderStatus', 'fetchBalance', 'createOrder', 'executeLossCut');
    this.emitter.on('{this.exchangeName}:orderNotMatched', this.executeLossCut);
    this.emitter.on('{this.exchangeName}:orderMatched', this.fetchBalance);
    this.emitter.on('{this.exchangeName}:orderCreated', this.checkOrderStatus);
    this.emitter.on('{this.exchangeName}:orderNotCreated', this.createOrder);
  },

  setMarket(market) {
    this.market = config[this.exchangeName].marketMap[market];
  },

  fetchBalance() {
    const self = this;

    this.balances = {};

    return new Promise((resolve, reject) => {
      // ここにbitflyerの資産残高を取得する処理を実装する
      self.requestPrivateAPI('GET', '/v1/me/getbalance', 'undefined', (error, response, body) => {
        if (!error && response.statusCode === 200 ) {
          const array = JSON.parse(body);
          _.each(array, (balance, index) => {
            self.balances[balance.currency_code.toLowerCase()] = balance.available;
          });

          logger.info('Balance for '.green + self.exchangeName + ' fetched successfully '.green + JSON.stringify(self.balances));

          self.emitter.emit('exchangeBalanceFetched', self.exchangeName);
        } else {
          logger.error('Error when checking balance for {self.exchangeName} : {error}');
          reject(new Error(JSON.parse(error)));
        }

        resolve(self);
      });
    });
  },

  createOrder(market, type, rate, amount) {
    // 注文を出す処理を実装する
    var self = this;
    this.hasOpenOrder = true;
    logger.info('Creating order for {amount} in {this.exchangeName} in market {market} to {type} at rate {rate}');
    const body = {
      product_code: this.market.name,
      child_order_type: 'LIMIT',
      side: type.toUpperCase(),
      price: rate,
      size: amount,
    };
    self.requestPrivateAPI('POST', '/v1/me/sendchildorder', body, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        const json = JSON.parse(body);
        logger.info('bitflyer child_order_acceptance_id {json.child_order_acceptance_id}');
        self.emitter.emit('{self.exchangeName}:orderCreated');
      } else {
        logger.error('bitflyer ORDER UNSUCCESSFULL '.red, body);
        _.delay(() => {
          self.emitter.emit('{self.exchangeName} :orderCreated');
        }, config.interval);
      }
    });
  },

  calculateProfit(amount, decimals) {
    const sellFee = config[this.exchangeName].fees[config.market].sell;
    return utils.calculateProfit(amount, this.prices.sell.price, sellFee.currency, sellFee.percentage, decimals);
  },

  calculateCost(amount, decimals) {
    const buyFee = config[this.exchangeName].fees[config.market].buy;
    return utils.calculateCost(amount, this.prices.buy.price, buyFee.currency, buyFee.percentage, decimals);
  },

  getExchangeInfo() {
    const market = this.market.name;
    const self = this;

    this.prices = {
      buy: {},
      sell: {},
    };

    return new Promise((resolve, reject) => {
      if (this.health === 'NORMAL') {
        logger.info('Checking prices for '.yellow + this.exchangeName);

        // 板から注文情報を取得する処理を実装する
        const getboardPath = '/v1/getboard?product_code=';
        request(self.host + getboardPath + market, (error, response, body) => {
          if (!error && response.statusCode == 200) {
            const json = JSON.parse(body);
            // 2つ目の価格と２つ目までの数量を代入する
            self.prices.sell.price = json.bids[2].price;
            self.prices.sell.quantity = (json.bids[1].size + json.bids[2].size) / 2;

            self.prices.buy.price = json.asks[2].price;
            self.prices.buy.quantity = (json.asks[1].size + json.asks[2].size) / 2;

            logger.info('Exchange prices for {self.exchangeName} fetched successfully!');
          } else {
            logger.error('error: {error}');
            reject(JSON.parse(error));
          }
          resolve(self);
        });
      } else {
        logger.info('{self.exchangeName} Skip to get exchange info. health is {this.health}');
        resolve(self);
      }
      this.checkHealth();
    });
  },

  // 最後に実行されてからconfig.interval/1000秒後にcallback関数呼ばれる
  checkOrderStatus: _.debounce(() => {
    return new Promise((resolve, reject) => {
      var self = this;
      const path = '/v1/me/getchildorders?product_code={this.market.name}&child_order_state=ACTIVE';
      // 注文したorderの状況を確認する
      self.requestPrivateAPI('GET', path, 'undefined', (error, response, body) =>{
        if (!error && response.statusCode === 200) {
          const json = JSON.parse(body);
          if (_.isEmpty(json)) {
            logger.info('order for {self.exchangeName} filled successfully!');
            _.delay(() => {
              self.hasOpenOrder = false;
              self.emitter.emit('{self.exchangeName}:orderMatched');
            }, config.interval);
          } else {
            logger.info('order for '.red + self.exchangeName + ' not filled yet!'.red + JSON.stringify(json));
            _.delay(() => {
              self.activeOrders = {
                child_order_id: json[0].child_order_id,
                type: json[0].side,
                rate: json[0].price,
                amount: json[0].outstanding_size,
              };
              self.emitter.emit('{self.exchangeName}:orderNotMatched');
            }, config.interval);
          }
        } else {
          logger.error('bitflyer checkOrderStatus UNSUCCESSFULL '.red, error);
          self.emitter.emit('{self.exchangeName}:orderNotMatched');
          reject(JSON.parse(error));
        }

        resolve(self);
      });
    });
  }, config.interval),

  requestPrivateAPI(method, path, body, callback) {
    var self = this;
    const timestamp = Date.now().toString();
    let text = timestamp + method + path;
    if (method === 'POST') {
      text += JSON.stringify(body);
    }

    const signedText = crypto.createHmac('sha256', config.bitflyer.secret).update(text).digest('hex');
    const options = {
      url: self.host + path,
      method,
      headers: {
        'ACCESS-KEY': config.bitflyer.apiKey,
        'ACCESS-TIMESTAMP': timestamp,
        'ACCESS-SIGN': signedText,
        'Content-Type': 'application/json',
      },
    };

    if (method === 'POST') {
      options.body = JSON.stringify(body);
    }

    request(options, callback);
  },

  executeLossCut() {
    return new Promise((resolve, reject) => {
      var self = this;
      const path = '/v1/me/cancelallchildorders';
      // 注文をキャンセルする
      const body = {
        product_code: self.market.name,
      };
      logger.info('bitflyer cancel childorder:{JSON.stringify(self.activeOrders)}');
      self.requestPrivateAPI('POST', path, body, (error, response) => {
        if (!error && response.statusCode === 200) {
          logger.info('bitflyer cancelchildorder SUCCESSFULL '.green);
          if (self.activeOrders.amount > self.market.minAmount) {
            let rate;
            if (self.activeOrders.type === 'BUY') {
              rate = parseInt(self.activeOrders.rate, 10) + 4000;
            } else if (self.activeOrders.type === 'SELL') {
              rate = parseInt(self.activeOrders.rate, 10) - 4000;
            }
            self.createOrder(config.market, self.activeOrders.type, rate, self.activeOrders.amount);
          } else {
            self.emitter.emit('{self.exchangeName} + :orderCreated');
          }
        } else {
          logger.error('bitflyer cancelchildorder UNSUCCESSFULL '.red, error);
          self.emitter.emit('{self.exchangeName} + :orderCreated');
          reject(JSON.parse(error));
        }

        resolve(self);
      });
    });
  },

  checkHealth() {
    return new Promise((resolve, reject) => {
      var self = this;
      const date = new Date();
      const maintainanceDate = new Date('2018-03-01T04:05:00');
      const diff = Math.abs(self.toMinute(maintainanceDate) - self.toMinute(date));
      const gethealthPath = '/v1/gethealth';

      if (diff <= 10) {
        self.health = 'MAINTAINANCE';
      } else {
        request(self.host + gethealthPath, (error, response, body) => {
          if (!error && response.statusCode === 200) {
            const json = JSON.parse(body);
            self.health = json.status;
          } else {
            logger.error('error: {error}');
            reject(JSON.parse(error));
          }
          resolve(self);
        });
      }
    });
  },

  toMinute(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

};
