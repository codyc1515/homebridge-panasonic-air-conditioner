var request = require("request");

var Characteristic,
	Service;

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.hap.Accessory;

	homebridge.registerAccessory("homebridge-panasonic-air-conditioner", "PanasonicAirConditioner", PanasonicAC);
};

function PanasonicAC(log, config) {
	_this = this;
	this.log = log;
	this.name = config["name"];
	this.email = config["email"];
	this.password = config["password"];
	this.debug = config["debug"] || false;
	this.token = null;
	this.device = null;
	this.version = "1.6.0";

	this.values = [];
	this.values.Active = Characteristic.Active.INACTIVE;
	this.values.CurrentTemperature = null;
	this.values.ThresholdTemperature = null;
	this.values.RotationSpeed = 0;

	// Log us in
	this._login();

	// Refresh the login token every 3 hours
	setInterval(function() {_this._login();}, 10800000);
}

PanasonicAC.prototype = {

	identify: function(callback) {
		this.log("identify");
		callback();
	},

	_login: function() {
		// Log us in
		request.post({
			url: "https://accsmart.panasonic.com/auth/login/",
			headers: {
				"Accept": "application/json; charset=UTF-8",
				"Content-Type": "application/json",
				"X-APP-TYPE": 0,
				"X-APP-VERSION": this.version
			},
			json: {
				"loginId": this.email,
				"language": "0",
				"password": this.password
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
						"X-APP-VERSION": this.version,
						"X-User-Authorization": this.token
					},
					json: "",
					rejectUnauthorized: false
				}, function(err, response, body) {
					if (!err && response.statusCode == 200) {
						var body = JSON.parse(body);
						this.device = body['groupList'][0]['deviceIdList'][0]['deviceGuid'];

						this.log("Logged into Panasonic account");
						return true;
					}
					else {
						this.log("Could not find any Panasonic Air Conditioner devices | Error # " + body['code'] + ": " + body['message']);

						this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
						return false;
					}
				}.bind(this));
			}
			else {
				try {this.log("Could not login to Panasonic account | Error # " + body['code'] + ": " + body['message']);}
				catch(err) {this.log("Could not login to Panasonic account | Unknown error. Did the API version change?", err);}

				this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
				return false;
			}
		}.bind(this));
	},

	getServices: function() {
		this.hcService = new Service.HeaterCooler(this.name);

		this.hcService
			.getCharacteristic(Characteristic.Active)
			.on('get', this._getValue.bind(this, "Active"))
			.on('set', this._setValue.bind(this, "Active"));

		this.hcService
			.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: 0,
				maxValue: 100,
				minStep: 0.01
			})
			.on('get', this._getValue.bind(this, "CurrentTemperature"));

		this.hcService
			.getCharacteristic(Characteristic.TargetTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('get', this._getValue.bind(this, "ThresholdTemperature"))
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		this.hcService
			.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		this.hcService
			.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		this.hcService
			.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.on('set', this._setValue.bind(this, "TargetHeaterCoolerState"));

		this.hcService
			.getCharacteristic(Characteristic.RotationSpeed)

			// RotationSpeed = 6 (the max in HomeKit) is converted to 0 for Auto mode
			.setProps({
				minValue: 1,
				maxValue: 6,
				minStep: 1
			})
			.on('set', this._setValue.bind(this, "RotationSpeed"));

		this.hcService
			.getCharacteristic(Characteristic.SwingMode)
			.on('set', this._setValue.bind(this, "SwingMode"));

		this.informationService = new Service.AccessoryInformation();
		this.informationService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, "Panasonic")
			.setCharacteristic(Characteristic.Model, "CZ-TACG1")
			.setCharacteristic(Characteristic.FirmwareRevision, this.version)
			.setCharacteristic(Characteristic.SerialNumber, this.device);

		return [
			this.informationService,
			this.hcService
		];
	},

	_getValue: function(CharacteristicName, callback) {
		if(this.debug) {this.log("GET", CharacteristicName);}

		switch (CharacteristicName) {
			case "Active":
				request.get({
					url: "https://accsmart.panasonic.com/deviceStatus/now/" + this.device,
					headers: {
						"Accept": "application/json; charset=UTF-8",
						"Content-Type": "application/json",
						"X-APP-TYPE": 0,
						"X-APP-VERSION": this.version,
						"X-User-Authorization": this.token
					},
					rejectUnauthorized: false
				}, function(err, response, body) {
					if (!err && response.statusCode == 200) {
						var json = JSON.parse(body);

						// Set the Rotation Speed
						// RotationSpeed = 6 (the max in HomeKit) is converted to 0 for Auto mode
						if(json['parameters']['fanSpeed'] == 0) {json['parameters']['fanSpeed'] = 6;}
						this.values.RotationSpeed = json['parameters']['fanSpeed'];
						this.hcService.getCharacteristic(Characteristic.RotationSpeed).updateValue(this.values.RotationSpeed);

						// Set the Swing Mode
						switch (json['parameters']['fanAutoMode']) {
							// These are inverted in Panasonic's API
							case 0: this.values.SwingMode = 1; break;
							case 1: this.values.SwingMode = 0; break;
						}
						this.hcService.getCharacteristic(Characteristic.SwingMode).updateValue(this.values.SwingMode);

						// Set the Active state
						if (json['parameters']['operate'] == 1) {
							this.values.Active = Characteristic.Active.ACTIVE;
							this.hcService.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);
						}
						else {
							this.values.Active = Characteristic.Active.INACTIVE;
							this.hcService.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
						}

						// Set Status Fault
						if(!json['parameters']['online'] || json['parameters']['errorStatusFlg']) {this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);}
						else {this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.NO_FAULT);}
					}
					else {
						// Not sending a callback if the command fails means the acceossry will "Not respond" which more accurately reflects the user experience
						try {this.log("Could not send GET command | HTTP response", response.statusCode, "| Error #", body['code'], ":", body['message']);}
						catch(err) {this.log("Could not send GET command | Unknown error. Did the API version change?", err);}

						this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
					}

					// Callback successfully with the Active state
					callback(null, this.values.Active);
				}.bind(this));
			break;

			case "CurrentTemperature":
				// Make the call again, otherwise a NULL value will be returned back to HomeKit while we wait for the GET Active call to complete (ideally there would be a promise here to avoid this)
				request.get({
					url: "https://accsmart.panasonic.com/deviceStatus/now/" + this.device,
					headers: {
						"Accept": "application/json; charset=UTF-8",
						"Content-Type": "application/json",
						"X-APP-TYPE": 0,
						"X-APP-VERSION": this.version,
						"X-User-Authorization": this.token
					},
					rejectUnauthorized: false
				}, function(err, response, body) {
					if (!err && response.statusCode == 200) {
						var json = JSON.parse(body);

						// Check the temperatures are accurate then set the Current Temperature & Current Heater Cooler State
						if (json['parameters']['insideTemperature'] < 99) {
							this.values.CurrentTemperature = json['parameters']['insideTemperature'];
							this.hcService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.values.CurrentTemperature);

							if (json['parameters']['insideTemperature'] < json['parameters']['temperatureSet']) {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.HEATING);}
							else if (json['parameters']['insideTemperature'] > json['parameters']['temperatureSet']) {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);}
							else {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);}
						}
						else if (json['parameters']['outTemperature'] < 99) {
							this.values.CurrentTemperature = json['parameters']['outTemperature'];
							this.hcService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.values.CurrentTemperature);

							if (json['parameters']['outTemperature'] < json['parameters']['temperatureSet']) {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.HEATING);}
							else if (json['parameters']['outTemperature'] > json['parameters']['temperatureSet']) {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);}
							else {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);}
						}
						else {
							this.values.CurrentTemperature = 0;
							this.hcService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(0);
							this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
						}

						// Set the Threshold Temperature
						this.values.ThresholdTemperature = json['parameters']['temperatureSet'];
						this.hcService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(this.values.ThresholdTemperature);
						this.hcService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(this.values.ThresholdTemperature);

						// Set the Target Heater Cooler State
						switch (json['parameters']['operationMode']) {
							case 0: // auto
								this.hcService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.AUTO);
								break;

							case 3: // heat
								this.hcService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.HEAT);
								break;

							case 2: // cool
								this.hcService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.COOL);
								break;
						}

						// Callback successfully with the Current Temperature
						callback(null, this.values.CurrentTemperature);
					}
					else {
						// Not sending a callback if the command fails means the acceossry will "Not respond" which more accurately reflects the user experience
						try {this.log("Could not send GET command | HTTP response", response.statusCode, "| Error #", body['code'], ":", body['message']);}
						catch(err) {this.log("Could not send GET command | Unknown error. Did the API version change?", err);}

						this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
					}
				}.bind(this));
			break;

			case "ThresholdTemperature":	callback(null, this.values.ThresholdTemperature);	break;
			case "RotationSpeed":			callback(null, this.values.RotationSpeed);			break;
			case "SwingMode":				callback(null, this.values.SwingMode);				break;

			default:						callback(null);										break;
		}
	},

	_setValue: function(CharacteristicName, value, callback) {
		if(this.debug) {this.log("SET", CharacteristicName, value);}

		var parameters;

		switch (CharacteristicName) {
			case "Active":
				switch (value) {
					case Characteristic.Active.ACTIVE:
						parameters = {
							"operate": 1
						};
					break;

					default:
						parameters = {
							"operate": 0
						};
					break;
				}
			break;

			case "TargetHeaterCoolerState":
				// The Panasonic API responses don't line up with what we expect
				switch (value) {
					case Characteristic.TargetHeaterCoolerState.COOL:
						parameters = {
							"operationMode": 2
						};
						this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(3);
					break;

					case Characteristic.TargetHeaterCoolerState.HEAT:
						parameters = {
							"operationMode": 3
						};
						this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(2);
					break;

					case Characteristic.TargetHeaterCoolerState.AUTO:
						parameters = {
							"operationMode": 0
						};
						this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(0);
					break;
				}
			break;

			case "ThresholdTemperature":
				parameters = {
					"temperatureSet": value
				};
			break;

			case "RotationSpeed":
				// RotationSpeed = 6 (the max in HomeKit) is converted to 0 for Auto mode
				if(value == 6) {value = 0;}
				parameters = {
					"fanSpeed": value
				};
			break;

			case "SwingMode":
				// These are invertered in Panasonic's API
				if(value == 1) {
					parameters = {
						"fanAutoMode": 0,
						"airSwingLR": 2,
						"airSwingUD": 0
					};
				}
				else {
					parameters = {
						"fanAutoMode": 1,
						"airSwingLR": 2,
						"airSwingUD": 0
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
				"X-APP-VERSION": this.version,
				"X-User-Authorization": this.token
			},
			json: {
				"deviceGuid": this.device,
				"parameters": parameters
			},
			rejectUnauthorized: false
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				callback();

				if (body.result !== 0) {
					this.log("Could not send SET command | Error # " + body['code'] + ": " + body['message']);
					this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
				}
				else {this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.NO_FAULT);}
			}
			else {
				try {this.log("Could not send SET command | HTTP response", response.statusCode, "| Error #", body['code'], ":", body['message']);}
				catch(err) {this.log("Could not send GET command | Unknown error. Did the API version change?", err);}

				this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
			}
		}.bind(this));
	}

};
