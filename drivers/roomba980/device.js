'use strict';

const Homey = require('homey');
const Roomba = require('./roomba');
const finder = require('./finder');

class Roomba980Device extends Homey.Device {
    onInit() {
        this._onOffline();
        this.registerCapabilityListener('vacuumcleaner_state', this._onVacuumCapabilityChanged.bind(this));
    }

    /**
     * Attempts to find the Roomba and connect to it. Also adds event listeners.
     *
     * This method searches for any existing Roomba on the network and compares
     * their MAC addresses. If it is the one we want (stored in device data), we
     * connect to it.
     */
    findRobot() {
        delete this.robot;
        this.setUnavailable(Homey.__('error.offline'));

        let data = this.getData();
        finder.roombas.forEach((roomba) => {
            if (roomba.mac !== data.mac) return;

            this.robot = new Roomba(data.auth.username, data.auth.password, roomba.ip);

            this.robot.on('connected', this._onConnected.bind(this));
            this.robot.on('offline', this._onOffline.bind(this));
            this.robot.on('error', this._onError.bind(this));
            this.robot.on('state', this._onState.bind(this));
        });
    }

    _onConnected() {
        clearInterval(this.reconnectInterval);
        this.setAvailable();
    }

    _onOffline() {
        this._disconnectFromRobot();
        this.findRobot();

        this.reconnectInterval = setInterval( () => {
            this.findRobot();
        }, 10000);
    }

    _onError(error) {
        this.error(`Error in Roomba connection: ${error}`);
    }

    _onState(state) {
        if (typeof state.batPct === 'number') this.setCapabilityValue('measure_battery', state.batPct);

        if (state && state.cleanMissionStatus
            && state.cleanMissionStatus.cycle
            && state.cleanMissionStatus.phase) {
            let cycle = state.cleanMissionStatus.cycle,
                phase = state.cleanMissionStatus.phase;

            if (cycle === 'none'
                && phase === 'charge') {
                if (this.getCapabilityValue('measure_battery') === 100) this.setCapabilityValue('vacuumcleaner_state', 'docked');
                else this.setCapabilityValue('vacuumcleaner_state', 'charging');
            } else if (phase === 'stop') this.setCapabilityValue('vacuumcleaner_state', 'stopped');
            else if (cycle === 'dock' && phase === 'hmUsrDock') this.setCapabilityValue('vacuumcleaner_state', 'docked');
            else if (cycle === 'quick' && phase === 'run') this.setCapabilityValue('vacuumcleaner_state', 'cleaning');
            else if (cycle === 'spot' && phase === 'run') this.setCapabilityValue('vacuumcleaner_state', 'spot_cleaning');
        }
    }

    _onVacuumCapabilityChanged(value) {
        switch (value) {
        case 'cleaning':
            return this.robot.start();
        case 'spot_cleaning':
            return Promise.reject(new Error(Homey.__('error.spot_cleaning')));
        case 'docked':
        case 'charging':
            return (this.robot.stop() && this.robot.dock());
        case 'stopped':
            return this.robot.stop();
        }
    }

    onDeleted() {
        clearInterval(this.reconnectInterval);
        this._disconnectFromRobot();
    }

    _disconnectFromRobot() {
        if (this.robot) {
            this.robot.removeAllListeners();
            this.robot.end();
        }
    }
}

module.exports = Roomba980Device;
