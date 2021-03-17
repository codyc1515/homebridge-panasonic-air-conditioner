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
	this.debug = config.debug || false;
	this.name = config.name || "Panasonic Air Conditioner";

	this.email = config.email;
	this.password = config.password;
	this.deviceNumber = config.devicenumber || 1;
	this.groupNumber = config.groupnumber || 1;

	this.uToken = null;
	this.version = "1.10.0";
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
		// Heater Cooler service
		this.HeaterCooler = new Service.HeaterCooler(this.name);

		// Heater Cooler - Active
		this.HeaterCooler
			.getCharacteristic(Characteristic.Active)
			.on('set', this._setValue.bind(this, "Active"));

		// Heater Cooler - Current Temperature
		this.HeaterCooler
			.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: -100,
				maxValue: 100,
				minStep: 0.01
			});

		// Heater Cooler - Current Heating Cooling State
		// Heater Cooler - Target Heating Cooling State
		this.HeaterCooler
			.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.on('set', this._setValue.bind(this, "TargetHeaterCoolerState"));

		// Heater Cooler - Rotation Speed
		this.HeaterCooler
			.getCharacteristic(Characteristic.RotationSpeed)
			.setProps({
				minValue: 1,
				maxValue: 5,
				minStep: 1
			})
			.on('set', this._setValue.bind(this, "RotationSpeed"));

		// Heater Cooler - Swing Mode
		this.HeaterCooler
			.getCharacteristic(Characteristic.SwingMode)
			.on('set', this._setValue.bind(this, "SwingMode"));

		// Heater Cooler - Cooling Threshold Temperature
		this.HeaterCooler
			.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		// Heater Cooler - Heating Threshold Temperature
		this.HeaterCooler
			.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		// Heater Cooler - Temperature Display Units

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
			this.HeaterCooler,
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
				this.uToken = body.uToken;
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
						body = JSON.parse(body);

						try {
							if(this.debug) {this.log("Login complete");}

							this.device = body['groupList'][this.groupNumber-1]['deviceList'][this.deviceNumber-1]['deviceGuid'];

							// Send a refresh off
							this._refresh();
						}
						catch(err) {this.log("Could not find device by number.", "Check your device number and try again.", err, "Error #", body.code, body.message);}
					}
					else {this.log("Could not find any devices.", "Error #", body.code, body.message);}
				}.bind(this));
			}
			else {
				try {this.log("Login failed.", "Error #", body.code, body.message);}
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
				body = JSON.parse(body);

				if(this.debug) {this.log(body);}

				// Check the temperature
				// Note - only update the temperature when the Heat Pump is reporting a valid temperature, otherwise it will just incorrectly report zero to HomeKit and FakeGato
				if (
					body.parameters.insideTemperature != 126 ||
					body.parameters.outTemperature != 126
				) {
					// Temperature of 126 from the API = null
					if (body.parameters.insideTemperature != 126) {this.temperature = body.parameters.insideTemperature;}
					else if (body.parameters.outTemperature != 126) {this.temperature = body.parameters.outTemperature;}

					this.HeaterCooler.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.temperature);
					this.FakeGatoHistory.addEntry({time: moment().unix(), temp: this.temperature});
				}
				else {this.log("Temperature state is not available", body.parameters.insideTemperature, body.parameters.outTemperature);}

				// Check the operating state
				if(body.parameters.operate == 1) {
					// Turn the Heater Cooler on
					this.HeaterCooler.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);

					// Set the Heater Cooler mode
					switch (body.parameters.operationMode) {
						// Auto
						case 0:
							if (this.temperature < body.parameters.temperatureSet) {this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.HEATING);}
							else if (this.temperature > body.parameters.temperatureSet) {this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);}
							else {this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);}

							this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.AUTO);
						break;

						// Heat
						case 3:
							if (this.temperature < body.parameters.temperatureSet) {this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.HEATING);}
							else {this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);}

							this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.HEAT);
						break;

						// Cool
						case 2:
							if (this.temperature > body.parameters.temperatureSet) {this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);}
							else {this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);}

							this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.COOL);
						break;

						// Dry (Dehumidifier)
						case 1:
							this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
							this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.OFF);
						break;

						// Fan
						case 4:
							this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
							this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.OFF);
						break;

						default:
							this.log("Unknown TargetHeaterCoolerState state", body.parameters.operationMode);
						break;
					}
				}
				else {
					// Turn the Heater Cooler off
					this.HeaterCooler.getCharacteristic(Characteristic.Active).updateValue(Characteristic.ACTIVE.INACTIVE);

					this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
					this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.OFF);
				}

				// Heater Cooler - Target Temperature
				this.HeaterCooler.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(body.parameters.temperatureSet);
				this.HeaterCooler.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(body.parameters.temperatureSet);

				// Heater Cooler - Temperature Display Units
				this.HeaterCooler.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(body.parameters.temperatureUnit);

				// Heater Cooler - Rotation Speed
				this.HeaterCooler.getCharacteristic(Characteristic.RotationSpeed).updateValue(body.parameters.fanSpeed);

				// Heater Cooler - Swing Mode
				if(body.parameters.airSwingLR == 2 && body.parameters.airSwingUD == 0) {this.HeaterCooler.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_ENABLED);}
				else {this.HeaterCooler.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_DISABLED);}

				// Status Fault
				if((body.parameters.online && !body.parameters.errorStatusFlg) && this.debug) {this.log("Refresh complete");}
				else {this.log("Refresh failed.", "Device may be offline or in error state.", "Online", body.parameters.online, "Error Status Flag", body.parameters.errorStatusFlg, "HTTP", response.statusCode, "Error #", body.code, body.message);}
			}
			else if(response.statusCode == 403) {this.log("Refresh failed.", "Login error.", "Did you enter the correct username and password? Please check the details & restart Homebridge.", err);}
			else if(response.statusCode == 401) {this.log("Refresh failed.", "Token error.", "The token may have expired.", err);}
			else {
				try {this.log("Refresh failed.", "HTTP", response.statusCode, "Error #", body.code, body.message);}
				catch(err) {this.log("Refresh failed.", "Unknown error.", "Did the API version change?", err);}
			}
		}.bind(this));
	},

	_setValue: function(CharacteristicName, value, callback) {
		if(this.debug) {this.log("SET", CharacteristicName, value, "start");}

		var parameters;

		switch (CharacteristicName) {
			// Heater Cooler - Active
			case "Active":
				switch (value) {
					case Characteristic.Active.ACTIVE:
						parameters = {
							"operate": 1
						};
					break;

					case Characteristic.Active.INACTIVE:
						parameters = {
							"operate": 0
						};
					break;
				}
			break;

			// Heater Cooler - Target Heating Cooling State
			case "TargetHeaterCoolerState":
				switch (value) {
					case Characteristic.TargetHeaterCoolerState.AUTO:
						parameters = {
							"operate": 1,
							"operationMode": 0
						};
					break;

					case Characteristic.TargetHeaterCoolerState.HEAT:
						parameters = {
							"operate": 1,
							"operationMode": 3
						};
					break;

					case Characteristic.TargetHeaterCoolerState.COOL:
						parameters = {
							"operate": 1,
							"operationMode": 2
						};
					break;

					default: this.log("Unknown TargetHeaterCoolerState", value); break;
				}
			break;

			// Heater Cooler - Target Temperature
			case "ThresholdTemperature":
				parameters = {
					"temperatureSet": value
				};
			break;

			// Heater Cooler - Temperature Display Units
			// @TODO - we cannot easily set this here (needs to be set on a different part of the API)

			// Heater Cooler - Rotation Speed
			case "RotationSpeed":
				parameters = {
					"fanSpeed": value
				};
			break;

			// Heater Cooler - Swing Mode ("Oscillate")
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
					this.log("SET failed.", "Error #", body.code, body.message);

					if(response.statusCode == 403) {this.log("Login error.", "Did you enter the correct username and password? Please check the details & restart Homebridge.", err);}
					else if(response.statusCode == 401) {this.log("Token error.", "The token may have expired.", err);}
				}
				else if(this.debug) {this.log("SET", CharacteristicName, value, "complete");}
			}
			else {
				try {this.log("SET failed.", "HTTP", response.statusCode, "Error #", body.code, body.message);}
				catch(err) {this.log("SET failed.", "Unknown error.", "Did the API version change?", err);}
			}
		}.bind(this));

		// Callback to HomeKit now that it's done
		callback(null, value);
	}

};
