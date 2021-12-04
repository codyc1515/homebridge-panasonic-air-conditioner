var request = require("request"),
	inherits = require("util").inherits,
	moment = require('moment');

var Accessory,
	Characteristic,
	Service,
	FakeGatoHistoryService;

const REFRESH_INTERVAL = 60000;
const LOGIN_INTERVAL = 10800000;
const LOGIN_RETRY_DELAY = 360000;
const USER_AGENT = "G-RAC";
const APP_VERSION = "1.13.0";

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
	this.temperature = 0.0;

	// Login for the first time and refresh
	this._login();
}

PanasonicAC.prototype = {

	_refreshInterval: null,
	_loginInterval: null,
	_loginRetry: null,

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
				minValue: 0,
				maxValue: 6,
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

		// Clear any pending timers
		clearInterval(this._refreshInterval);
		clearInterval(this._loginInterval);
		clearTimeout(this._loginRetry);

		// Call the API
		request.post({
			url: "https://accsmart.panasonic.com/auth/login/",
			headers: {
				"Accept": "application/json; charset=UTF-8",
				"Content-Type": "application/json",
				"User-Agent": USER_AGENT,
				"X-APP-TYPE": 0,
				"X-APP-VERSION": APP_VERSION
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
						"User-Agent": USER_AGENT,
						"X-APP-TYPE": 0,
						"X-APP-VERSION": APP_VERSION,
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
						catch(err) {this.log("Could not find device by number. Check you have specified the correct device number in config, then restart Homebridge.", err, "Error #", body.code, body.message);}
					}
					else {
						try {this.log("Could not find any devices. Check you have added one in the Comfort Cloud app.", body['code'], body['message']);}
						catch(err) {this.log("Could not find any devices. Check you have added one in the Comfort Cloud app.", err);}
					}

					// Set a timer to refresh the data
					this._refreshInterval = setInterval(this._refresh.bind(this), REFRESH_INTERVAL);

					// Set a timer to refresh the login token
					this._loginInterval = setInterval(this._login.bind(this), LOGIN_INTERVAL);
				}.bind(this));
			}
			else {
				try {this.log("Failed to login. Check the configured email and password, then restart Homebridge.", body.code, body.message);}
				catch(err) {this.log("Unknown error. An update to the plug-in may be required. Check for the latest version.", err);}

				this._loginRetry = setTimeout(this._login.bind(this), LOGIN_RETRY_DELAY);
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
				"User-Agent": USER_AGENT,
				"X-APP-TYPE": 0,
				"X-APP-VERSION": APP_VERSION,
				"X-User-Authorization": this.uToken
			}
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				body = JSON.parse(body);

				if(this.debug) {this.log(body);}

				// Check the temperature
				// Note - only update the temperature when the Heat Pump is reporting a valid temperature, otherwise it will just incorrectly report zero to HomeKit and FakeGato
				if (
					body.parameters.insideTemperature < 126 ||
					body.parameters.outTemperature < 126
				) {
					// Temperature of 126 from the API = null
					if (body.parameters.insideTemperature < 126) {this.temperature = body.parameters.insideTemperature;}
					else if (body.parameters.outTemperature < 126) {this.temperature = body.parameters.outTemperature;}

					this.HeaterCooler.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.temperature);
					this.FakeGatoHistory.addEntry({time: moment().unix(), temp: this.temperature});
				}
				else if(this.debug) {this.log("Temperature state is not available", body.parameters.insideTemperature, body.parameters.outTemperature);}

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
							this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.COOL);
						break;

						// Fan
						case 4:
							this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
							this.HeaterCooler.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.COOL);
						break;

						default:
							this.log("Unknown TargetHeaterCoolerState state", body.parameters.operationMode);
						break;
					}
				}
				else {
					// Turn the Heater Cooler off
					this.HeaterCooler.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);
					this.HeaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
				}

				// Heater Cooler - Target Temperature
				if(body.parameters.temperatureSet >= 16 && body.parameters.temperatureSet <= 30){
					this.HeaterCooler.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(body.parameters.temperatureSet);
					this.HeaterCooler.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(body.parameters.temperatureSet);
				}

				// Heater Cooler - Temperature Display Units
				this.HeaterCooler.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(body.temperatureUnit);

				// Heater Cooler - Rotation Speed
				if(body.parameters.fanSpeed == 0) {this.HeaterCooler.getCharacteristic(Characteristic.RotationSpeed).updateValue(6);}
				else {this.HeaterCooler.getCharacteristic(Characteristic.RotationSpeed).updateValue(body.parameters.fanSpeed);}

				// Heater Cooler - Swing Mode
				if(body.parameters.airSwingLR == 2 && body.parameters.airSwingUD == 0) {this.HeaterCooler.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_ENABLED);}
				else {this.HeaterCooler.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_DISABLED);}

				// Status Fault
				if(body.parameters.errorStatusFlg) {this.log("Error - Device is in error state. Check the Comfort Cloud app for errors. ", body.parameters.errorStatusFlg, body.code, body.message);}
				else if(this.debug) {this.log("Refreshed succesfully");}
			}
			else {
				try {
					if(response.statusCode == 500 || response.statusCode == 503) {
						if(body.code == 5005) {this.log("Warning - Device has lost connectivity to Comfort Cloud. Check your Wi-Fi connectivity or restart the Heat Pump.", body.code, body.message);}
						else {this.log("Error - 500 Internal Server Error. Comfort Cloud server is experiencing issues.", err);}
					}
					else if(response.statusCode == 403) {this.log("Error - 403 Forbidden. Check the configured email and password, then restart Homebridge.", err);}
					else if(response.statusCode == 401) {
						this.log("Warning - 401 Unauthorized. Login token has expired.", err);

						this._loginRetry = setTimeout(this._login.bind(this), LOGIN_RETRY_DELAY);
					}
					else {this.log("Unknown error. An update to the plug-in may be required. Check for the latest version.", "HTTP", response.statusCode, "Error #", body.code, body.message);}
				}
				catch(err) {this.log("Unknown error. An update to the plug-in may be required. Check for the latest version.", err);}
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
				if(value == 6) {value = 0;}

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
				"User-Agent": USER_AGENT,
				"X-APP-TYPE": 0,
				"X-APP-VERSION": APP_VERSION,
				"X-User-Authorization": this.uToken
			},
			json: {
				"deviceGuid": this.device,
				"parameters": parameters
			}
		}, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				if (body.result !== 0) {
				}
				else if(this.debug) {this.log("Set", CharacteristicName, value, "successfully");}
			}
			else {
				try {
					if(response.statusCode == 500 || response.statusCode == 503) {
						if(body.code == 5005) {this.log("Warning - Device has lost connectivity to Comfort Cloud. Check your Wi-Fi connectivity or restart the Heat Pump.", body.code, body.message);}
						else {this.log("Error - 500 Internal Server Error. Comfort Cloud server is experiencing issues.", err);}
					}
					else if(response.statusCode == 403) {this.log("Error - 403 Forbidden. Check the configured email and password, then restart Homebridge.", body.code, body.message, err);}
					else if(response.statusCode == 401) {this.log("Warning - 401 Unauthorized. Login token has expired.", body.code, body.message, err);}
					else {this.log("Unknown error. An update to the plug-in may be required. Check for the latest version.", response.statusCode, body.code, body.message);}
				}
				catch(err) {this.log("Unknown error. An update to the plug-in may be required. Check for the latest version.", err);}
			}
		}.bind(this));

		// Callback to HomeKit now that it's done
		callback(null, value);
	}

};
