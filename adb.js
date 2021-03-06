import usb from 'usb';
import { USB_VENDOR_IDS, ADB_VALUES, CONNECTION_TYPES } from './lib/constants';
import { logExceptOnTest } from './lib/helpers';
import ADBDevice from './lib/adb-device';
import Promise from 'bluebird';

const NOT_CONNECTED = 0;
const WAIT_FOR_AUTH = 1;
const SEND_PRIVATE_KEY = 2;
const SEND_PUBLIC_KEY = 3;
const CONNECTED = 4;

class ADB {
  constructor (connectionType, device) {
    if (connectionType === CONNECTION_TYPES.USB || connectionType === CONNECTION_TYPES.TCP) {
      this.state = NOT_CONNECTED;
      this.device = new ADBDevice(connectionType, device);
    } else {
      throw new Error("Cannot create new ADB device, invalid connection type.");
    }
  }

  // *** STATIC FUNCTIONS ***
  static async _getSerialNo (device) {
    let langid = 0x0409;
    let length = 255;
    let deviceDescriptor = device.deviceDescriptor;
    device.open();
    let tempDevice = Promise.promisifyAll(device);
    let serialNumber = await tempDevice.controlTransferAsync(usb.LIBUSB_ENDPOINT_IN
                                                 , usb.LIBUSB_REQUEST_GET_DESCRIPTOR
                                                 , ((usb.LIBUSB_DT_STRING << 8) | deviceDescriptor.iSerialNumber)
                                                 , langid
                                                 ,length);
    device.close();
    return serialNumber.toString('utf16le', 2);
  }

  // return an array of devices that have an ADB interface
  static async findAdbDevices () {
    logExceptOnTest("Trying to find a usb device");
    let adbDevices = [];
    let usbDevices = usb.getDeviceList();
    // node-usb docs are unclear on if this will ever happen
    // or if libusb throws it's own error for no devices
    if (usbDevices.length === 0) {
      throw new Error("No USB devices found.");
    }
    for (let device of usbDevices) {
      let vendorID = device.deviceDescriptor.idVendor;
      if (USB_VENDOR_IDS.indexOf(vendorID) === -1) continue;
      let deviceInterface = this._getAdbInterface(device);
      if (deviceInterface !== null) {
        logExceptOnTest("Found an ADB device");
        let serialNumber = await this._getSerialNo(device);
        adbDevices.push({device, deviceInterface, serialNumber});
      }
    }
    if (adbDevices.length === 0) {
      throw new Error("No ADB devices found.");
    }
    return adbDevices;
  }

  // search through a devices interfaces for an interface
  // that can be used for ADB communications
  static _getAdbInterface (device) {
    device.open();
    if (device.interfaces === null) return null;

    if (device.deviceDescriptor !== null && device.configDescriptor !== null) {
      // if the vendorID is not part of the vendors we recognize

      let interfaces = device.interfaces;
      let returnInterface = null;
      for (let iface of interfaces) {
        // ADB interface will only have two endpoints
        if (iface.endpoints.length !== 2) continue;
        // interface for ADB always has these values in it's descriptor
        if (iface.descriptor.bInterfaceClass !== ADB_VALUES.ADB_CLASS ||
          iface.descriptor.bInterfaceSubClass !== ADB_VALUES.ADB_SUBCLASS ||
          iface.descriptor.bInterfaceProtocol !== ADB_VALUES.ADB_PROTOCOL) {
          continue;
        }
        // if we get to this point we have the interface we want
        returnInterface = iface;
        break;
      }
      return returnInterface;
    }
    return null;
  }
  // *** END OF STATIC FUNCTIONS ***

  // runs the connection state machine
  async connect () {
    let packet;
    while (1) {
      switch (this.state) {
        case NOT_CONNECTED:
          logExceptOnTest("NOT_CONNECTED");
          await this.device.initConnection();
          this.state = WAIT_FOR_AUTH;
          break;
        case WAIT_FOR_AUTH:
          logExceptOnTest("WAIT_FOR_AUTH");
          try {
            packet = await this.device.waitForAuth();
            if (packet === false) {
              this.state = NOT_CONNECTED;
            } else {
              this.state = SEND_PRIVATE_KEY;
            }
          } catch (e) {
            if (e.errno === 2) {
              logExceptOnTest("Timeout error, this should never happen: ", this.state);
              this.state = NOT_CONNECTED;
            } else {
              throw e;
            }
          }
          break;
        case SEND_PRIVATE_KEY:
          logExceptOnTest("SEND_PRIVATE_KEY");
          try {
            if (await this.device.sendSignedToken(packet.data)) {
              this.state = CONNECTED;
            } else {
              this.state = SEND_PUBLIC_KEY;
            }
          } catch (e) {
            if (e.errno === 2) {
              logExceptOnTest("Timeout error, this should never happen: ", this.state);
              this.state = NOT_CONNECTED;
            } else {
              throw e;
            }
          }
          break;
        case SEND_PUBLIC_KEY:
          logExceptOnTest("SEND_PUBLIC_KEY");
          try {
            if (await this.device.sendPublicKey()) {
              this.state = CONNECTED;
            } else {
              this.state = NOT_CONNECTED;
            }
          } catch (e) {
            if (e.errno === 2) { //timeout error
              logExceptOnTest("Timeout error, did you accept the public key on the device?");
              this.state = NOT_CONNECTED;
            } else {
              throw e;
            }
          }
          break;
        case CONNECTED: // ready to start runing command on the device now
          logExceptOnTest("CONNECTED");
          return;
        default: //wtf
          this.state = NOT_CONNECTED;
      }
    }
  }

  async runCommand (command) {
    let output = null;
    if (this.state === CONNECTED) {
      output = await this.device.open(command);
    } else {
      throw new Error("State is not CONNECTED, cannot run a command.");
    }
    return output;
  }

  async closeConnection () {
    if (this.state === CONNECTED) {
      await this.device.closeConnection();
      this.state = NOT_CONNECTED;
    } else {
      logExceptOnTest("Not connection to close.");
    }
  }
}

export default ADB;