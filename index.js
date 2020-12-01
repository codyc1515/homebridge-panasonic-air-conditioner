var request = require("request"),
	inherits = require("util").inherits,
	moment = require('moment');

var Accessory,
	Characteristic,
	Service,
	FakeGatoHistoryService;

module.exports = function(homebridge) {
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Accessory = homebridge.hap.Accessory;

	FakeGatoHistoryService = require('fakegato-history')(homebridge);

	homebridge.registerAccessory("homebridge-panasonic-air-conditioner", "PanasonicAirConditioner", PanasonicAC);
};

function PanasonicAC(log, config) {
	this.log = log;
	this.debug = config["debug"] || false;
	this.name = config["name"] || "Panasonic Air Conditioner";

	this.email = config["email"];
	this.password = config["password"];
	this.deviceNumber = config["devicenumber"] || 1;

	this.uToken = null;
	this.version = "1.7.0";
	this.temperature = 0.0;

	// Login for the first time and refresh
	this._login();

	// Set a timer to refresh the data every 10 minutes
	setInterval(function() {
		this._refresh();
	}.bind(this), 600000);

	// Set a timer to refresh the login token every 3 hours
	setInterval(function() {
		this._login();
	}.bind(this), 10800000);
}

PanasonicAC.prototype = {

	identify: function(callback) {
		this.log("identify");
		callback();
	},

	getServices: function() {
		// Thermostat service
		this.Thermostat = new Service.Thermostat(this.name);

		// Thermostat - Current Heating Cooling State
		// Thermostat - Target Heating Cooling State
		this.Thermostat
			.getCharacteristic(Characteristic.TargetHeatingCoolingState)
			.on('set', this._setValue.bind(this, "TargetHeatingCoolingState"));

		// Thermostat - Current Temperature
		this.Thermostat
			.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: 0,
				maxValue: 100,
				minStep: 0.01
			});

		// Thermostat - Target Temperature
		this.Thermostat
			.getCharacteristic(Characteristic.TargetTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('set', this._setValue.bind(this, "TargetTemperature"));

		// Thermostat - Temperature Display Units

		// FanV2 service
		this.Fan = new Service.Fanv2(this.name);

		// Fan - Active
		this.Fan
			.getCharacteristic(Characteristic.Active)
			.on('set', this._setValue.bind(this, "Active"));

		// Fan - Rotation Speed
		this.Fan
			.getCharacteristic(Characteristic.RotationSpeed)
			.setProps({
				minValue: 1,
				maxValue: 6,
				minStep: 1
			})
			.on('set', this._setValue.bind(this, "RotationSpeed"));

		// Fan - Swing Mode
		this.Fan
			.getCharacteristic(Characteristic.SwingMode)
			.on('set', this._setValue.bind(this, "SwingMode"));

		// FakeGato History service
		this.FakeGatoHistory = new FakeGatoHistoryService("weather", Accessory);

		// Accessory Information service
		this.AccessoryInformation = new Service.AccessoryInformation();
		this.AccessoryInformation
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, "Panasonic")
			.setCharacteristic(Characteristic.Model, "CZ-TACG1")
			.setCharacteristic(Characteristic.FirmwareRevision, this.version)
			.setCharacteristic(Characteristic.SerialNumber, this.device);

		// Return the Accessory
		return [
			this.AccessoryInformation,
			this.Thermostat,
			this.Fan,
			this.FakeGatoHistory
		];
	},

	_login: function() {
		if(this.debug) {this.log("Login start");}

		// Call the API
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
			}
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				this.uToken = body['uToken'];
				request.get({
					url: "https://accsmart.panasonic.com/device/group/",
					headers: {
						"Accept": "application/json; charset=UTF-8",
						"Content-Type": "application/json",
						"X-APP-TYPE": 0,
						"X-APP-VERSION": this.version,
						"X-User-Authorization": this.uToken
					},
					json: ""
				}, function(err, response, body) {
					if (!err && response.statusCode == 200) {
						var body = JSON.parse(body);

						try {
							if(this.debug) {this.log("Login complete");}

							this.device = body['groupList'][this.deviceNumber-1]['deviceIdList'][this.deviceNumber-1]['deviceGuid'];

							// Send a refresh off
							this._refresh();
						}
						catch(err) {this.log("Could not find device by number.", "Check your device number and try again.", err, "Error #", body['code'], body['message']);}
					}
					else {this.log("Could not find any devices.", "Error #", body['code'], body['message']);}
				}.bind(this));
			}
			else {
				try {this.log("Login failed.", "Error #", body['code'], body['message']);}
				catch(err) {this.log("Login failed.", "Unknown error.", "Did the API version change?", err);}
			}
		}.bind(this));
	},

	_getValue: function(CharacteristicName, callback) {
		if(this.debug) {this.log("GET", CharacteristicName);}
		callback(null);
	},

	_refresh: function() {
		if(this.debug) {this.log("Refresh start");}

		request.get({
			url: "https://accsmart.panasonic.com/deviceStatus/now/" + this.device,
			headers: {
				"Accept": "application/json; charset=UTF-8",
				"Content-Type": "application/json",
				"X-APP-TYPE": 0,
				"X-APP-VERSION": this.version,
				"X-User-Authorization": this.uToken
			}
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				var json = JSON.parse(body);

				if(this.debug) {this.log(json);}

				// Check the device is operating
				if(json['parameters']['operate'] == 1) {
					// Temperature of 126 from the API = null
					if (json['parameters']['insideTemperature'] != 126) {this.temperature = json['parameters']['insideTemperature'];}
					else if (json['parameters']['outTemperature'] != 126) {this.temperature = json['parameters']['outTemperature'];}
					else {this.log("Temperature state is not available", json['parameters']['insideTemperature'], json['parameters']['outTemperature']);}

					// Only update the temperature when the Heat Pump is switched on, otherwise it will just incorrectly report zero to HomeKit and FakeGato
					this.Thermostat.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.temperature);
					this.FakeGatoHistory.addEntry({time: moment().unix(), temp: this.temperature});

					// Turn the Fan on
					this.Fan.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);

					// Turn the Thermostat on
					// Thermostat - Current Heating Cooling State
					// Thermostat - Target Heating Cooling State
					switch (json['parameters']['operationMode']) {
						// Auto
						case 0:
							if (this.temperature < json['parameters']['temperatureSet']) {this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.HEAT);}
							else if (this.temperature > json['parameters']['temperatureSet']) {this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.COOL);}
							else {this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.OFF);}

							this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.AUTO);
						break;

						// Heat
						case 3:
							if (this.temperature < json['parameters']['temperatureSet']) {this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.HEAT);}
							else {this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.OFF);}

							this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.HEAT);
						break;

						// Cool
						case 2:
							if (this.temperature > json['parameters']['temperatureSet']) {this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.COOL);}
							else {this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.OFF);}

							this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.COOL);
						break;

						// Dry
						case 1:
							this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.COOL);
							this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.COOL);
						break;

						// Fan
						case 4:
							this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.COOL);
							this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.COOL);
						break;

						default:
							this.log("Unknown TargetHeatingCoolingState state", json['parameters']['operationMode']);
						break;
					}
				}

				else {
					// Turn the Thermostat off
					this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.OFF);
					this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.OFF);

					// Turn the Fan off
					this.Fan.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
				}

				// Thermostat - Target Temperature
				this.Thermostat.getCharacteristic(Characteristic.TargetTemperature).updateValue(json['parameters']['temperatureSet']);

				// Thermostat - Temperature Display Units
				this.Thermostat.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(json['parameters']['temperatureUnit']);

				// Fan - Rotation Speed
				var rotationSpeed;
				if(json['parameters']['fanSpeed'] == 0) {rotationSpeed = 6;}
				else {rotationSpeed = json['parameters']['fanSpeed'];}

				this.Fan.getCharacteristic(Characteristic.RotationSpeed).updateValue(rotationSpeed);

				// Fan - Swing Mode
				if(json['parameters']['airSwingLR'] == 2 && json['parameters']['airSwingUD'] == 0) {this.Fan.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_ENABLED);}
				else {this.Fan.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_DISABLED);}

				// Status Fault
				if(json['parameters']['online'] && !json['parameters']['errorStatusFlg']) {
					if(this.debug) {this.log("Refresh complete");}
					this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.NO_FAULT);
				}
				else {
					this.log("Refresh failed.", "Device may be offline or in error state", "Online", json['parameters']['online'], "Error Status Flag", json['parameters']['errorStatusFlg'], "HTTP response", response.statusCode, "Error #", body['code'], body['message']);
					this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
				}
			}
			else if(response.statusCode == 403) {
				this.log("Refresh failed.", "Login error.", "Did you enter the correct username and password? Please check the details & restart Homebridge.", err);
				this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
			}
			else if(response.statusCode == 401) {
				this.log("Refresh failed.", "Token error.", "The token may have expired.", err);
				this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
			}
			else {
				try {this.log("Refresh failed.", "HTTP response", response.statusCode, "Error #", body['code'], body['message']);}
				catch(err) {this.log("Refresh failed.", "Unknown error.", "Did the API version change?", err);}

				this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
			}
		}.bind(this));
	},

	_setValue: function(CharacteristicName, value, callback) {
		if(this.debug) {this.log("SET", CharacteristicName, value, "start");}

		var parameters;

		switch (CharacteristicName) {
			// Thermostat - Target Heating Cooling State
			case "TargetHeatingCoolingState":
				switch (value) {

					// @TODO - need to update the fan speed when turning on the thermostat

					case Characteristic.TargetHeatingCoolingState.OFF:
						parameters = {
							"operate": 0
						};
						this.Fan.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
					break;

					case Characteristic.TargetHeatingCoolingState.HEAT:
						parameters = {
							"operate": 1,
							"operationMode": 3
						};
						this.Fan.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);
					break;

					case Characteristic.TargetHeatingCoolingState.COOL:
						parameters = {
							"operate": 1,
							"operationMode": 2
						};
						this.Fan.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);
					break;

					case Characteristic.TargetHeatingCoolingState.AUTO:
						parameters = {
							"operate": 1,
							"operationMode": 0
						};
						this.Fan.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);
					break;

					default: this.log("Unknown TargetHeatingCoolingState", value); break;
				}
			break;

			// Thermostat - Target Temperature
			case "TargetTemperature":
				parameters = {
					"temperatureSet": value
				};
			break;

			// Thermostat - Temperature Display Units
			// @TODO - we cannot easily set this here - needs to be set on a different webpage in the API

			// Fan - Active
			case "Active":
				switch (value) {

					// @TODO - need to update the thermostat mode when turning on the fan (instead of default to cool)

					case Characteristic.Active.ACTIVE:
						parameters = {
							"operate": 1
						};
						this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.COOL);
						this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.COOL);
					break;

					case Characteristic.Active.INACTIVE:
						parameters = {
							"operate": 0
						};
						this.Thermostat.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(Characteristic.CurrentHeatingCoolingState.OFF);
						this.Thermostat.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(Characteristic.TargetHeatingCoolingState.OFF);
					break;

				}
			break;

			// Fan - Rotation Speed
			case "RotationSpeed":
				switch (value) {
					case 6:
						parameters = {
							"fanSpeed": 0
						};
					break;

					default:
						parameters = {
							"fanSpeed": value
						};
					break;
				}
			break;

			// Fan - Swing Mode
			case "SwingMode":
				switch (value) {
					case Characteristic.SwingMode.SWING_ENABLED:
						parameters = {
							"fanAutoMode": 0,
							"airSwingLR": 2,
							"airSwingUD": 0
						};
					break;

					case Characteristic.SwingMode.SWING_DISABLED:
						parameters = {
							"fanAutoMode": 1,
							"airSwingLR": 2,
							"airSwingUD": 0
						};
					break;
				}
			break;
		}

		// Call the API
		request.post({
			url: "https://accsmart.panasonic.com/deviceStatus/control/",
			headers: {
				"Accept": "application/json; charset=UTF-8",
				"Content-Type": "application/json",
				"X-APP-TYPE": 0,
				"X-APP-VERSION": this.version,
				"X-User-Authorization": this.uToken
			},
			json: {
				"deviceGuid": this.device,
				"parameters": parameters
			}
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				if (body.result !== 0) {
					this.log("SET failed.", "Error #", body['code'], body['message']);
					this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);

					if(response.statusCode == 403) {this.log("Login error.", "Did you enter the correct username and password? Please check the details & restart Homebridge.", err);}
					else if(response.statusCode == 401) {this.log("Token error.", "The token may have expired.", err);}
				}
				else {
					if(this.debug) {this.log("SET", CharacteristicName, value, "complete");}

					// Clear any faults
					this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.NO_FAULT);
				}
			}
			else {
				try {this.log("SET failed.", "HTTP response", response.statusCode, "Error #", body['code'], body['message']);}
				catch(err) {this.log("SET failed.", "Unknown error.", "Did the API version change?", err);}

				this.Thermostat.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
			}
		}.bind(this));

		// Callback to HomeKit now that it's done
		callback(null, value);
	}

};
