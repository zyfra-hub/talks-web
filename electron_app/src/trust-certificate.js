/**
 * Created by t3chg on 22/06/2017.
 */

const {app, dialog} = require('electron');

module.exports = {};

const certificates = [];

module.exports.register = function(browserWindow) {
    app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
        if (certificates.includes(certificate.fingerprint)) {
            event.preventDefault();
            callback(true);
            return;
        };

        if ((process.platform === 'darwin' || process.platform === 'win32') && false) {

        }

        // dialog.showCertificateTrustDialog(browserWindow, { certificate, message: 'Would you like to ignore this?' }, () => {});
        dialog.showMessageBox(browserWindow, {
            type: 'warning',
            buttons: [
                'Yes',
                'No',
            ],
            defaultId: 0,
            title: 'SSL Certificate Error',
            message: 'Would you like to trust this cert anyway?',
            detail: error + '\n'
                + 'Fingerprint: ' + certificate.fingerprint + '\n'
                + 'Subject Name: ' + certificate.subjectName + '\n'
                + 'Issuer Name: ' + certificate.issuerName + '\n'
                + 'Serial: ' + certificate.serialNumber,
            cancelId: 1,

        }, function(response, _) {
            console.log(response);
            if (response === 0) {
                certificates.push(certificate.fingerprint);
                console.log(certificates);
                event.preventDefault();
                callback(true);
            } else {
                callback(false);
            }
        });
    });
}


