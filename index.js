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
	this.log = log;
	this.debug = config["debug"] || false;
	this.name = config["name"];

	this.email = config["email"];
	this.password = config["password"];
	this.uToken = null;

	this.deviceNumber = config["devicenumber"] || 1;
	this.version = "1.6.0";

	// Start running the refresh process (login and set timer)
	try {this._login(true);}
	catch(err) {this.log("Login failure", err);}
}

PanasonicAC.prototype = {

	identify: function(callback) {
		this.log("identify");
		callback();
	},

	getServices: function() {
		// Heater Cooler Service
		this.hcService = new Service.HeaterCooler(this.name);

		// Active
		this.hcService
			.getCharacteristic(Characteristic.Active)
			.on('set', this._setValue.bind(this, "Active"));

		// Current Temperature
		this.hcService
			.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({
				minValue: 0,
				maxValue: 100,
				minStep: 0.01
			});

		// Current Heater Cooler State

		// Target Heater Cooler State
		this.hcService
			.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.on('set', this._setValue.bind(this, "TargetHeaterCoolerState"));

		// Cooling Threshold Temperature
		this.hcService
			.getCharacteristic(Characteristic.CoolingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		// Heating Threshold Temperature
		this.hcService
			.getCharacteristic(Characteristic.HeatingThresholdTemperature)
			.setProps({
				minValue: 16,
				maxValue: 30,
				minStep: 0.5
			})
			.on('set', this._setValue.bind(this, "ThresholdTemperature"));

		// Rotation Speed
		this.hcService
			.getCharacteristic(Characteristic.RotationSpeed)
			.setProps({
				minValue: 1,
				maxValue: 6,
				minStep: 1
			})
			.on('set', this._setValue.bind(this, "RotationSpeed"));

		// Swing Mode
		this.hcService
			.getCharacteristic(Characteristic.SwingMode)
			.on('set', this._setValue.bind(this, "SwingMode"));

		// Accessory Information Service
		this.informationService = new Service.AccessoryInformation();
		this.informationService
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.Manufacturer, "Panasonic")
			.setCharacteristic(Characteristic.Model, "CZ-TACG1")
			.setCharacteristic(Characteristic.FirmwareRevision, this.version)
			.setCharacteristic(Characteristic.SerialNumber, this.device);

		return [
			this.hcService,
			this.informationService
		];
	},

	_login: function(isInitial) {
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
							this.log("Login complete");
							this.device = body['groupList'][this.deviceNumber-1]['deviceIdList'][this.deviceNumber-1]['deviceGuid'];
							this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.NO_FAULT);
						}
						catch(err) {
							this.log("Could not find device by number.", "Check your device number and try again.", err, "Error #", body['code'], body['message']);
							this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
						}

						if(isInitial) {
							// Refresh the data on initial load
							this._refresh();

						    // Refresh the data every 10 minutes
						    setInterval(function() {this._refresh();}.bind(this), 600000);

							// Refresh the login token every 3 hours
							setInterval(function() {this._login();}.bind(this), 10800000);
						}
					}
					else {
						this.log("Could not find any devices.", "Error #", body['code'], body['message']);
						this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
					}
				}.bind(this));
			}
			else {
				try {this.log("Login failed.", "Error #", body['code'], body['message']);}
				catch(err) {this.log("Login failed.", "Unknown error.", "Did the API version change?", err);}

				this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
				return false;
			}
		}.bind(this));
	},

	_getValue: function(CharacteristicName, callback) {
		callback();
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

				// Active
				switch (json['parameters']['operate']) {
					case 1:	this.hcService.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);		break;
					case 0:	this.hcService.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.INACTIVE);	break;
				}

				// Current Temperature
				var temperature = 0;
				if (json['parameters']['insideTemperature'] < 99) {temperature = json['parameters']['insideTemperature'];}
				else if (json['parameters']['outTemperature'] < 99) {temperature = json['parameters']['outTemperature'];}

				this.hcService.getCharacteristic(Characteristic.CurrentTemperature).updateValue(temperature);

				// Current Heater Cooler State
				if (temperature < json['parameters']['temperatureSet']) {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.HEATING);}
				else if (temperature > json['parameters']['temperatureSet']) {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);}
				else {this.hcService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);}

				// Target Heater Cooler State
				switch (json['parameters']['operationMode']) {
					case 0:	this.hcService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.AUTO);	break;
					case 3:	this.hcService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.HEAT);	break;
					case 2: this.hcService.getCharacteristic(Characteristic.TargetHeaterCoolerState).updateValue(Characteristic.TargetHeaterCoolerState.COOL);	break;
				}

				// Rotation Speed
				var rotationSpeed;
				if(json['parameters']['fanSpeed'] == 0) {rotationSpeed = 6;}
				else {rotationSpeed = json['parameters']['fanSpeed'];}

				this.hcService.getCharacteristic(Characteristic.RotationSpeed).updateValue(rotationSpeed);

				// Swing Mode
				switch (json['parameters']['fanAutoMode']) {
					case 0: this.hcService.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_ENABLED);		break;
					case 1: this.hcService.getCharacteristic(Characteristic.SwingMode).updateValue(Characteristic.SwingMode.SWING_DISABLED);	break;
				}

				// Threshold Temperature
				this.hcService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(json['parameters']['temperatureSet']);
				this.hcService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(json['parameters']['temperatureSet']);

				// Status Fault
				if(json['parameters']['online'] && !json['parameters']['errorStatusFlg']) {
					if(this.debug) {this.log("Refresh complete");}
					this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.NO_FAULT);
				}
				else {
					this.log("Refresh failed.", "Device may be offline or in error state", "Online", json['parameters']['online'], "Error Status Flag", json['parameters']['errorStatusFlg'], "HTTP response", response.statusCode, "Error #", body['code'], body['message']);
					this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
				}
			}
			else {
				try {this.log("Refresh failed.", "HTTP response", response.statusCode, "Error #", body['code'], body['message']);}
				catch(err) {this.log("Refresh failed.", "Unknown error.", "Did the API version change?", err);}

				this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
			}
		}.bind(this));
	},

	_setValue: function(CharacteristicName, value, callback) {
		if(this.debug) {this.log("SET", CharacteristicName, value, "start");}

		var parameters;

		switch (CharacteristicName) {
			// Active
			case "Active":
				switch (value) {
					case Characteristic.Active.ACTIVE:		parameters = { "operate": 1 };	break;
					case Characteristic.Active.INACTIVE:	parameters = { "operate": 0 };	break;
				}
			break;

			// Target Heater Cooler State
			case "TargetHeaterCoolerState":
				switch (value) {
					case Characteristic.TargetHeaterCoolerState.AUTO:	parameters = { "operationMode": 0 };	break;
					case Characteristic.TargetHeaterCoolerState.HEAT:	parameters = { "operationMode": 3 };	break;
					case Characteristic.TargetHeaterCoolerState.COOL:	parameters = { "operationMode": 2 };	break;
				}

				// TODO: Change the Current Heater Cooler State
			break;

			// Rotation Speed
			case "RotationSpeed":
				switch (value) {
					case 6:		parameters = { "fanSpeed": 0 };			break;
					default:	parameters = { "fanSpeed": value };		break;
				}
			break;

			// Swing Mode
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

			// Cooling Threshold Temperature
			// Heating Threshold Temperature
			case "ThresholdTemperature":
				parameters = { "temperatureSet": value };
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
					this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
				}
				else {
					if(this.debug) {this.log("SET", CharacteristicName, value, "complete");}

					// Callback to HomeKit now that it's done
					callback(null, value);

					// Clear any faults
					this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.NO_FAULT);
				}
			}
			else {
				try {this.log("SET failed.", "HTTP response", response.statusCode, "Error #", body['code'], body['message']);}
				catch(err) {this.log("SET failed.", "Unknown error.", "Did the API version change?", err);}

				this.hcService.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
			}
		}.bind(this));
	}

};
