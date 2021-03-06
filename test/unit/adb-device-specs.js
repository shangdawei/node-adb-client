import chai from 'chai';
import { fs } from 'appium-support';
import chaiAsPromised from 'chai-as-promised';
import { withMocks, verify } from 'appium-test-support';
import USBDevice from '../../lib/usb-device';
import ADBDevice from '../../lib/adb-device';
import { CONNECT_VALUES
       , ADB_COMMANDS
       , CONNECTION_TYPES } from '../../lib/constants';
import { generateMessage, packetFromBuffer } from '../../lib/helpers';

process.env.NODE_ENV = 'test';

chai.should();
chai.use(chaiAsPromised);
let expect = chai.expect;

describe('adb-device', () => {
  let inputEndpoint = { transferAsync: () => { return "nothing"; } };
  let outputEndpoint = { transferAsync: () => { return "nothing"; } };
  let usbDevice = new USBDevice();
  usbDevice.inputEndpoint = inputEndpoint;
  usbDevice.outputEndpoint = outputEndpoint;
  let adbDevice = new ADBDevice(CONNECTION_TYPES.USB, usbDevice);
  adbDevice.device = usbDevice;
  let localId, remoteId = 12345;

  describe('recvAndOkay', withMocks({ usbDevice }, (mocks) => {
    it('should call _sendMsg with command okay', async () => {
      mocks.usbDevice.expects('_recvMsg')
        .once()
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA);
      mocks.usbDevice.expects('_sendMsg')
        .once()
        .withExactArgs(ADB_COMMANDS.CMD_OKAY, localId, remoteId, "");
      await adbDevice.recvAndOkay(localId, remoteId);
      mocks.usbDevice.verify();
    });
  }));
  describe('sendAndOkay', withMocks({ usbDevice }, (mocks) => {
    it('should throw an error containing the command type if the command was not OKAY', async () => {
      let fakePacket = packetFromBuffer(generateMessage(ADB_COMMANDS.CMD_CLSE, localId, remoteId, ""));
      mocks.usbDevice.expects('_sendMsg')
        .once()
        .withExactArgs(ADB_COMMANDS.CMD_WRTE, localId, remoteId, "test");
      mocks.usbDevice.expects('_recvMsg')
        .once()
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns(fakePacket);
      await adbDevice.sendAndOkay(ADB_COMMANDS.CMD_WRTE, localId, remoteId, "test")
              .should.be.rejected;
      mocks.usbDevice.verify();
    });
    it('should return a packet with command type OKAY if command was OKAY', async () => {
      let fakePacket = packetFromBuffer(generateMessage(ADB_COMMANDS.CMD_OKAY, localId, remoteId, ""));
      mocks.usbDevice.expects('_sendMsg')
        .once()
        .withExactArgs(ADB_COMMANDS.CMD_WRTE, localId, remoteId, "test");
      mocks.usbDevice.expects('_recvMsg')
        .once()
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns(fakePacket);
      await adbDevice.sendAndOkay(ADB_COMMANDS.CMD_WRTE, localId, remoteId, "test")
            .should.be.fulfilled;
      mocks.usbDevice.verify();
    });
  }));
  describe('shell', withMocks({ adbDevice }, (mocks) => {
    it('should be rejected if open response is not okay', async () => {
      let shellString = "shell:test.";
      mocks.adbDevice.expects('sendAndOkay')
        .once()
        .withExactArgs(ADB_COMMANDS.CMD_OPEN
                      , 12345
                      , 0
                      , shellString)
        .returns({ command: "not okay" });
      adbDevice.shell("test", false).should.be.rejected;
      verify(mocks);
    });
  }));
  describe('open', withMocks({ adbDevice, fs }, (mocks) => {
    it('should call shell if command.type is shell', async () => {
      let command = {
        type: "shell"
      , string: "ls -al"
      , print: false
      };
      mocks.adbDevice.expects('shell')
        .once()
        .withExactArgs(command.string, command.print);
      await adbDevice.open(command);
      verify(mocks);
    });
    it('should not call push if fs.stat errors because the file does not exist', async () => {
      let command = {
        type: "push"
      , source: "nonExistantFile"
      , destination: "doesntMatter"
      };
      mocks.fs.expects('stat')
        .once()
        .withExactArgs(command.source)
        .throws();
      mocks.adbDevice.expects('push')
        .never();
      await adbDevice.open(command);
      verify(mocks);
    });
    it('should call push if fs.stat does not error', async () => {
      let command = {
        type: "push"
      , source: "existantFile"
      , destination: "doesntMatter"
      };
      mocks.fs.expects('stat')
        .once()
        .withExactArgs(command.source)
        .returns("nothing");
      mocks.adbDevice.expects('push')
        .once();
      await adbDevice.open(command);
      verify(mocks);
    });
    it('should call pull if command.type is pull', async () => {
      let command = {
        type: "pull"
      , source: "test"
      , destination: "testTwo"
      };
      mocks.adbDevice.expects('pull')
        .once()
        .withExactArgs(command.source, command.destination);
      await adbDevice.open(command);
      verify(mocks);
    });
    it('should call list if command.type is pull', async () => {
      let command = {
        type: "list"
      , remotePath: "test"
      };
      mocks.adbDevice.expects('list')
        .once()
        .withExactArgs(command.remotePath);
      await adbDevice.open(command);
      verify(mocks);
    });
    it('should call install if command.type is install', async () => {
      let command = {
        type: "install"
      , source: "test.apk"
      };
      mocks.adbDevice.expects('install')
        .once()
        .withExactArgs(command.source);
      await adbDevice.open(command);
      verify(mocks);
    });
    it('should call uninstall if command.type is uninstall', async () => {
      let command = {
        type: "uninstall"
      , packageName: "testPackage"
      };
      mocks.adbDevice.expects('uninstall')
        .once()
        .withExactArgs(command.packageName);
      await adbDevice.open(command);
      verify(mocks);
    });
    it('should call reboot if command.type is reboot', async () => {
      let command = {
        type: "reboot"
      };
      mocks.adbDevice.expects('reboot')
        .once();
      await adbDevice.open(command);
      verify(mocks);
    });
  }));
  describe('sendPublicKey', withMocks({ usbDevice }, mocks => {
    it('should return true if response was CNXN',  async () => {
      mocks.usbDevice.expects('_sendMsg')
        .once()
        .withArgs(ADB_COMMANDS.CMD_AUTH, 3, 0);
      mocks.usbDevice.expects('_recvMsg')
        .once()
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns({ command: ADB_COMMANDS.CMD_CNXN });
      expect(await adbDevice.sendPublicKey()).to.be.true;
      verify(mocks);
    });
    it('should return false if response was not CNXN',  async () => {
      mocks.usbDevice.expects('_sendMsg')
        .once()
        .withArgs(ADB_COMMANDS.CMD_AUTH, 3, 0);
      mocks.usbDevice.expects('_recvMsg')
        .once()
        .withExactArgs(CONNECT_VALUES.CONNECT_MAXDATA)
        .returns({ command: "not cnxn" });
      expect(await adbDevice.sendPublicKey()).to.be.false;
      verify(mocks);
    });
  }));
});
