var colors          = require('colors'),
    _               = require('underscore'),
    Deferred        = require("promised-io/promise").Deferred,
    config          = require('./../config'),
    utils           = require('../utils'),
    crypto          = require('crypto'),
    querystring     = require('querystring'),
    request           = require('request');

module.exports = {

    exchangeName: 'zaif',
    host: 'https://api.zaif.jp/tapi',

    balances: {},

    prices: {},

    emitter: {},

    activeOrders: {},

    balancesMap: {},

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

        var queryParam = {
          method : "get_info"
        };

        self.requestPrivateAPI(queryParam, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            if (json.success===1){
              _.each(json.return.funds, function(val, key){
                self.balances[key] = val;
              });
            } else {
              console.log('error: ' + json.error);
            }

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

        var adjusted = self.adjust(type, rate);
        var queryParam = {
          method : "trade",
          currency_pair: this.market.name.toLowerCase(),
          action : adjusted.action,
          price : adjusted.price,
          amount : amount
        };
        self.requestPrivateAPI(queryParam, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            if (json.success===1){
              console.log(self.exchangeName + " order id is " + json.return.order_id);
              self.emitter.emit(self.exchangeName + ':orderCreated');
            } else {
              console.log('error: ' + json.error);
            }

          } else {
            console.log('zaif ORDER UNSUCCESSFULL '.red, body);
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
        request("https://api.zaif.jp/api/1/depth/" + market.toLowerCase(), function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            //3つ目の価格と、2つ目と3つ目の数量の平均を代入する。一つの取引所内ではsell.price - buy.priceが常に負になるようにする。
            self.prices.sell.price=json.bids[2][0];
            self.prices.sell.quantity=(json.bids[1][1] + json.bids[2][1])/2;

            self.prices.buy.price=json.asks[2][0];
            self.prices.buy.quantity=(json.asks[1][1] + json.asks[2][1])/2;
            console.log('Exchange prices for ' + self.exchangeName + ' fetched successfully!');
          } else {
            console.log('error: ' + error);
          }
          try {deferred.resolve(self);} catch (e){}
        });

        setTimeout(function () {
            try {deferred.resolve();} catch (e){}
        }, config.requestTimeouts.prices);

        return deferred.promise;
    },

    //最後に実行されてからconfig.interval/1000秒後にcallback関数呼ばれる
    checkOrderStatus: _.debounce(function () {
        var deferred = new Deferred();
        var self = this;
        //注文したorderの状況を確認する
        var queryParam = {
          method : "active_orders",
          currency_pair : this.market.name.toLowerCase()
        };
        self.requestPrivateAPI(queryParam, function(error, response, body){
          if (!error && response.statusCode == 200){
            var json = JSON.parse(body);
            if (json.success===1){
              if (_.isEmpty(json.return)){
                console.log('order for '.green + self.exchangeName + ' filled successfully!'.green);
                _.delay(function () {
                    self.hasOpenOrder = false;
                    self.emitter.emit(self.exchangeName + ':orderMatched');
                }, config.interval);
              } else {
                console.log('order for '.red + self.exchangeName + ' not filled yet!'.red);
                _.delay(function () {
                  var order_id = _.keys(json.return)[0];
                  var content = json.return[order_id];
                    self.activeOrders = {
                      order_id : order_id,
                      type : content.action,
                      rate : content.price,
                      amount : content.amount
                    };
                    self.emitter.emit(self.exchangeName + ':orderNotMatched');
                }, config.interval);
              }
            } else {
              console.log('error: ' + json.error);
            }

          } else {
            console.log('zaif checkOrderStatus UNSUCCESSFULL '.red, error);
            self.emitter.emit(self.exchangeName + ':orderNotMatched');
          }

          deferred.resolve(self);
        });
        return deferred.promise;
    }, config.interval),

    requestPrivateAPI: function(queryString, callback){
      var self = this;
      queryString.nonce = Date.now()/1000;
      var text = querystring.stringify(queryString);
      var signed_text = crypto.createHmac('sha512', config.zaif.secret).update(text).digest('hex');
      var options = {
        url: self.host,
        method : 'POST',
        headers: {
            'key': config.zaif.apiKey,
            'sign': signed_text,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        form : queryString
      };

      request(options, callback);
    },

    adjust: function(type, rate){
      var modResult = rate % 5;
      if (type==="buy"){
        return {action:"bid", price: rate - modResult};
      } else if (type==="sell"){
        return {action:"ask", price: rate + (5 - modResult)};
      }
    },

    executeLossCut: function(){
      var deferred = new Deferred();
      var self = this;
      //注文をキャンセルする
      var queryParam = {
        method : "cancel_order",
        order_id : self.activeOrders.order_id
      };
      console.log('zaif cancel order:' + JSON.stringify(self.activeOrders));
      self.requestPrivateAPI(queryParam, function(error, response, body){
        var json = JSON.parse(body);
        if (!error && response.statusCode == 200 && (json.success===1)){
          console.log('zaif cancel order SUCCESSFULL '.green);
          if (self.activeOrders.amount > self.market.minAmount){
            var rate;
            var type;
            if (self.activeOrders.type==="bid"){
              rate = parseInt(self.activeOrders.rate) + 1000;
              type = "buy";
            } else if (self.activeOrders.type==="ask"){
              rate = parseInt(self.activeOrders.rate) - 1000;
              type = "sell";
            }
            self.createOrder(config.market, type, rate, self.activeOrders.amount);
          } else {
            self.emitter.emit(self.exchangeName + ':orderCreated');
          }
        } else {
          console.log('zaif cancel order UNSUCCESSFULL '.red, error);
          self.emitter.emit(self.exchangeName + ':orderCreated');
        }

        deferred.resolve(self);
      });
      return deferred.promise;
    }

};
