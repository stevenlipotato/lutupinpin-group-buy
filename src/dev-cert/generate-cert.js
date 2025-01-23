const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

// 生成自签名证书
function generateCert() {
    // 生成密钥对
    const keys = forge.pki.rsa.generateKeyPair(2048);
    
    // 创建证书
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    // 设置证书属性
    const attrs = [{
        name: 'commonName',
        value: 'localhost'
    }, {
        name: 'countryName',
        value: 'CN'
    }, {
        shortName: 'ST',
        value: 'Development'
    }, {
        name: 'localityName',
        value: 'Development'
    }, {
        name: 'organizationName',
        value: 'Development'
    }, {
        shortName: 'OU',
        value: 'Development'
    }];

    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey);

    // 导出证书和私钥
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

    // 保存文件
    fs.writeFileSync(path.join(__dirname, 'cert.pem'), certPem);
    fs.writeFileSync(path.join(__dirname, 'key.pem'), keyPem);

    console.log('证书生成成功！');
}

generateCert(); 