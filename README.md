# homebridge-panasonic-air-conditioner
Panasonic Air Conditioner / Heat Pump plugin for [HomeBridge](https://github.com/nfarina/homebridge) using the Panasonic *Comfort Cloud* API to expose Panasonic Air Conditioners to Apples HomeKit.

## Things to know
* Supports only a single Air Conditioner
* Tested only with the *CZ-TACG1* adapter but may support *built-in Wi-Fi adapter* & *CZ-CAPWFC1* adapter
* Supports *Air Conditioner* and may support *Commercial Air Conditioner*, however I don't think *Air to Water Heat Pump* is supported as these use the *Panasonic AQUAREA* app which is separate

## Getting started

### Supported devices
Panasonic Air Conditioner that has a CZ-TACG1 adapter installed

### Setup the app
1. Download, install & setup the *Panasonic Comfort Cloud* app on your mobile device
2. Create a login & add your Air Conditioner to the *Comfort Cloud*

> **Caution!** It is recommended to setup another login for the *Comfort Cloud* and share your home to that login, as opposed to using your regular login for this plugin. Otherwise the *Comfort Cloud* app will log you out each time that you use this plugin (as only one user can be logged into the *Comfort Cloud* per login).

3. Share your login to another user setup specifically for HomeBridge

### Legal
* Licensed under [MIT](LICENSE)
* This is not an official plug-in and is not affiliated with Panasonic in any way
