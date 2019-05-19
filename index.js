var fs = require("fs");
var request = require("request");

var Service, Characteristic;

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.hap.Accessory;

	homebridge.registerAccessory("homebridge-panasonic-air-conditioner", "PanasonicAirConditioner", PanasonicAC);
};

function PanasonicAC(log, config) {
	this.log = log;
	this.name = config["name"];
	this.email = config["email"];
	this.password = config["password"];
	this.debug = config["debug"] || false;
	this.token = null;
	this.device = null;

	// log us in
	request.post({
		url: "https://accsmart.panasonic.com/auth/login/",
		headers: {
			"Accept": "application/json; charset=UTF-8",
			"Content-Type": "application/json",
			"X-APP-TYPE": 0,
			"X-APP-VERSION": "1.5.0"
		},
		json: {
			"loginId": config["email"],
			"language": "0",
			"password": config["password"]
		},
		rejectUnauthorized: false
	}, function(err, response, body) {
		if (!err && response.statusCode == 200) {
			this.token = body['uToken'];
			request.get({
				url: "https://accsmart.panasonic.com/device/group/",
				headers: {
					"Accept": "application/json; charset=UTF-8",
					"Content-Type": "application/json",
					"X-APP-TYPE": 0,
					"X-APP-VERSION": "1.5.0",
					"X-User-Authorization": this.token
				},
				json: "",
				rejectUnauthorized: false
			}, function(err, response, body) {
				if (!err && response.statusCode == 200) {
					var body = JSON.parse(body);
					this.device = body['groupList'][0]['deviceIdList'][0]['deviceGuid'];
					this.log("Logged into Panasonic account succesfully and obtained devices");
				} else {
					this.log("Could not find Panasonic Air Conditioner devices");
				}
			}.bind(this));
		} else {
			this.log("Could not login to Panasonic account");
		}
	}.bind(this));
}

PanasonicAC.prototype = {

	identify: function(callback) {
		this.log("identify");
		callback();
	},

	getServices: function() {
		this.HeaterCooler = new Service.HeaterCooler(this.name);

		this.HeaterCooler
			.getCharacteristic(Characteristic.Active)
			.on('get', this._getValue.bind(this, "Active"))
			.on('set', this._setValue.bind(this, "Active"));

		this.HeaterCooler
			.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: 0,
				maxValue: 100,
				minStep: 0.01
			})
			.on('get', this._getValue.bind(this, "CurrentTemperature"));

		this.HeaterCooler
			.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.on('get', this._getValue.bind(this, "TargetHeaterCoolerState"))
			.on('set', this._setValue.bind(this, "TargetHeaterCoolerState"));

		this.HeaterCooler
			.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.on('get', this._getValue.bind(this, "CurrentHeaterCoolerState"));

		this.HeaterCooler
			.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('get', this._getValue.bind(this, "ThresholdTemperature"))
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		this.HeaterCooler
			.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('get', this._getValue.bind(this, "ThresholdTemperature"))
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		this.SwitchEconavi = new Service.Switch("ECONAVI", "PanasonicAC-ECONAVI");
		this.SwitchEconavi.getCharacteristic(Characteristic.On)
			.on('get', this._getValue.bind(this, "Econavi"))
			.on('set', this._setValue.bind(this, "Econavi"));

		this.SwitchQuiet = new Service.Switch("Quiet", "PanasonicAC-Quiet");
		this.SwitchQuiet.getCharacteristic(Characteristic.On)
			.on('get', this._getValue.bind(this, "Quiet"))
			.on('set', this._setValue.bind(this, "Quiet"));

		this.SwitchPowerful = new Service.Switch("Powerful", "PanasonicAC-Powerful");
		this.SwitchPowerful.getCharacteristic(Characteristic.On)
			.on('get', this._getValue.bind(this, "Powerful"))
			.on('set', this._setValue.bind(this, "Powerful"));

		var informationService = new Service.AccessoryInformation();
		informationService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, "Panasonic")
			.setCharacteristic(Characteristic.Model, "CZ-TACG1")
			.setCharacteristic(Characteristic.FirmwareRevision, "1.5.0")
			.setCharacteristic(Characteristic.SerialNumber, this.device);

		return [informationService, this.HeaterCooler, this.SwitchEconavi, this.SwitchQuiet, this.SwitchPowerful];
	},

	_getValue: function(CharacteristicName, callback) {
		if (this.debug) {
			this.log("GET", CharacteristicName);
		}

		request.get({
			url: "https://accsmart.panasonic.com/deviceStatus/now/" + this.device,
			headers: {
				"Accept": "application/json; charset=UTF-8",
				"Content-Type": "application/json",
				"X-APP-TYPE": 0,
				"X-APP-VERSION": "1.5.0",
				"X-User-Authorization": this.token
			},
			rejectUnauthorized: false
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				var json = JSON.parse(body);

				switch (CharacteristicName) {
					case "Active":
						if (json['parameters']['operate'] == 1) {
							this.HeaterCooler.getCharacteristic(Characteristic.Active).updateValue("ACTIVE");
							callback(null, Characteristic.Active.ACTIVE);
						} else {
							this.HeaterCooler.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							callback(null, Characteristic.Active.INACTIVE);
						}
						break;

					case "CurrentTemperature":
						var currentTemperature = null;
						if (fs.existsSync("/var/homebridge/temp.txt")) {
							currentTemperature = fs.readFileSync("/var/homebridge/temp.txt", "utf8");
						} else if (json['parameters']['insideTemperature'] < 100) {
							currentTemperature = json['parameters']['insideTemperature'];
						} else if (json['parameters']['outTemperature'] < 100) {
							currentTemperature = json['parameters']['outTemperature'];
						}

						this.HeaterCooler.getCharacteristic(Characteristic.CurrentTemperature).updateValue(currentTemperature);
						callback(null, currentTemperature);
						break;

					case "ThresholdTemperature":
						this.HeaterCooler.getCharacteristic(Characteristic.TargetTemperature).updateValue(json['parameters']['temperatureSet']);
						callback(null, json['parameters']['temperatureSet']);
						break;

					case "TargetHeaterCoolerState":
						switch (json['parameters']['operationMode']) {
							case 0: // auto
								this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).setValue(0);
								callback(null, 0);
								break;

							case 3: // heat
								this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).setValue(1);
								callback(null, 1);
								break;

							case 2: // cool
								this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).setValue(2);
								callback(null, 2);
								break;
						}
						break;

					case "CurrentHeaterCoolerState":
						if (json['parameters']['insideTemperature'] < 100) {
							if (json['parameters']['insideTemperature'] < json['parameters']['temperatureSet']) {
								callback(null, Characteristic.CurrentHeaterCoolerState.HEATING);
							} else if (json['parameters']['insideTemperature'] > json['parameters']['temperatureSet']) {
								callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
							} else {
								callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
							}
						} else if (json['parameters']['outTemperature'] < 100) {
							if (json['parameters']['outTemperature'] < json['parameters']['temperatureSet']) {
								callback(null, Characteristic.CurrentHeaterCoolerState.HEATING);
							} else if (json['parameters']['outTemperature'] > json['parameters']['temperatureSet']) {
								callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
							} else {
								callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
							}
						} else {
							callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
						}
						break;

					case "Econavi":
						if (json['parameters']['ecoNavi'] == 2) {
							this.SwitchQuiet.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							this.SwitchPowerful.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							this.SwitchEconavi.getCharacteristic(Characteristic.Active).updateValue("ACTIVE");
							callback(null, Characteristic.Active.ACTIVE);
						} else {
							this.SwitchEconavi.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							callback(null, Characteristic.Active.INACTIVE);
						}
						break;

					case "Quiet":
						if (json['parameters']['ecoMode'] == 2) {
							this.SwitchQuiet.getCharacteristic(Characteristic.Active).updateValue("ACTIVE");
							this.SwitchPowerful.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							this.SwitchEconavi.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							callback(null, Characteristic.Active.ACTIVE);
						} else {
							this.SwitchQuiet.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							callback(null, Characteristic.Active.INACTIVE);
						}
						break;

					case "Powerful":
						if (json['parameters']['ecoMode'] == 1) {
							this.SwitchQuiet.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							this.SwitchPowerful.getCharacteristic(Characteristic.Active).updateValue("ACTIVE");
							this.SwitchEconavi.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							callback(null, Characteristic.Active.ACTIVE);
						} else {
							this.SwitchPowerful.getCharacteristic(Characteristic.Active).updateValue("INACTIVE");
							callback(null, Characteristic.Active.INACTIVE);
						}
						break;
				}
			} else {
				this.log("Could not send GET command");
				callback();
			}
		}.bind(this));
	},

	_setValue: function(CharacteristicName, value, callback) {
		if (this.debug) {
			this.log("SET", CharacteristicName, value);
		}

		var parameters;

		switch (CharacteristicName) {
			case "Active":
				if (value == Characteristic.Active.ACTIVE) {
					parameters = {
						"operate": 1
					};
				} else {
					parameters = {
						"operate": 0
					};
				}
				break;

			case "TargetHeaterCoolerState":
				switch (value) {
					case Characteristic.TargetHeaterCoolerState.COOL:
						parameters = {
							"operationMode": 2
						};
						this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).setValue(3);
						break;

					case Characteristic.TargetHeaterCoolerState.HEAT:
						parameters = {
							"operationMode": 3
						};
						this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).setValue(2);
						break;

					case Characteristic.TargetHeaterCoolerState.AUTO:
						parameters = {
							"operationMode": 0
						};
						this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).setValue(0);
						break;
				}
				break;

			case "ThresholdTemperature":
				parameters = {
					"temperatureSet": value
				};
				break;

			case "Econavi":
				if (value == Characteristic.Active.ACTIVE) {
					parameters = {
						"ecoNavi": 2
					};
				} else {
					parameters = {
						"ecoNavi": 1
					};
				}
				break;

			case "Quiet":
				if (value == Characteristic.Active.ACTIVE) {
					parameters = {
						"ecoMode": 2
					};
				} else {
					parameters = {
						"ecoMode": 0
					};
				}
				break;

			case "Powerful":
				if (value == Characteristic.Active.ACTIVE) {
					parameters = {
						"ecoMode": 1
					};
				} else {
					parameters = {
						"ecoMode": 0
					};
				}
				break;
		}

		request.post({
			url: "https://accsmart.panasonic.com/deviceStatus/control/",
			headers: {
				"Accept": "application/json; charset=UTF-8",
				"Content-Type": "application/json",
				"X-APP-TYPE": 0,
				"X-APP-VERSION": "1.5.0",
				"X-User-Authorization": this.token
			},
			json: {
				"deviceGuid": this.device,
				"parameters": parameters
			},
			rejectUnauthorized: false
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				if (body.result == 0) {
					callback();
				} else {
					this.log("Could not send SET command");
					callback();
				}
			} else {
				this.log("Could not send SET command");
				callback();
			}
		}.bind(this));
	}

};
