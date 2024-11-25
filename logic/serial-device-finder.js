import { SerialPort } from 'serialport'

/**
 * Class to represent a serial device
 */
export class SerialDevice {
    constructor(vendorID, productID, serialPort = null, serialNumber = null) {
        this.vendorID = vendorID;
        this.productID = productID;
        this.serialNumber = serialNumber;
        this.serialPort = serialPort;
        this.manufacturer = null;
        this.name = null;
    }

    toString() {
        return `${this.manufacturer} ${this.name} at ${this.serialPort}`;
    }
}

/**
 * Class to find connected serial devices
 */
export class SerialDeviceFinder {

    /**
     * Get a list of connected devices. Optionally filter by vendorID and productID.
     * @param {number} vendorIDFilter The vendor ID to filter by
     * @param {number} productIDFilter The product ID to filter by
     * @returns {Promise<Array<SerialDevice>>} List of connected devices as SerialDevice objects.
     */
    async getDeviceList(vendorIDFilter = null, productIDFilter = null) {
        let devices = [];
        const ports = await SerialPort.list();

        for (const port of ports) {
            if(port.vendorId === undefined || port.productId === undefined) continue;
            const vendorID = parseInt(port.vendorId, 16);
            const productID = parseInt(port.productId, 16);

            if(vendorIDFilter && vendorID !== vendorIDFilter) continue;
            if(productIDFilter && productID !== productIDFilter) continue;

            let serialNumber = port.serialNumber;

            // Check if serial number contains an ampersand (bug on Windows)
            // SEE: https://github.com/serialport/node-serialport/issues/2726
            if(port.serialNumber?.includes('&')){
                serialNumber = null;
            }

            let portPath = port.path;
            // On macOS use the cu port instead of the tty port for better stability.
            if(process.platform === 'darwin' && portPath.includes('/tty.')){
                portPath = portPath.replace('/tty.', '/cu.');
            }

            const newDevice = new SerialDevice(vendorID, productID, portPath, serialNumber);
            newDevice.manufacturer = port.manufacturer;
            newDevice.name = `Generic Device`; // Fallback name
            devices.push(newDevice);
        }
        return devices;
    }
}
