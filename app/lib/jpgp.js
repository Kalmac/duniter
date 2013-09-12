var openpgp = require('./openpgp').openpgp;

openpgp.init();

function JPGP() {

  this.args = [];
  this.signature = "";
  this.uid = "";
  this.data = "";
  this.noCarriage = false;

  // PUBLIC
  this.publicKey = function(asciiArmored) {
    openpgp.keyring.importPublicKey(asciiArmored);
    return this;
  };

  this.certificate = function(asciiArmored) {
    var readKeys = openpgp.read_publicKey(asciiArmored);
    if(readKeys.length == 0){
      throw new Error('No key found in ASCII armored message');
    }
    if(readKeys.length > 1){
      throw new Error('Multiple keys found in ASCII armored message');
    }
    var cert = readKeys[0];
    var fpr = hexstrdump(cert.publicKeyPacket.getFingerprint()).toUpperCase();
    var uids = [];
    cert.userIds.forEach(function (uid) {
      uids.push(uid.text);
    });
    return {
      "fingerprint": fpr,
      "uids": uids,
      "raw": cert
    };
  };

  this.signature = function(asciiArmored) {
    this.signature = asciiArmored;
    return this;
  };

  this.issuer = function() {
    var issuer = "";
    try{
      var signatures = openpgp.read_message(this.signature);
      var sig = null;
      signatures.forEach(function (siga) {
        if(siga.messagePacket && siga.messagePacket.tagType == 2)
          sig = siga;
      });
      if(!sig){
        throw new Error("No signature packet found");
      }
      issuer = hexstrdump(sig.signature.getIssuer()).toUpperCase();
      if(!issuer){
        issuer = JSON.stringify(signatures);
      }
    }
    catch(ex){
      console.log("Error with signature: " + ex);
    }
    return issuer;
  };

  this.data = function(data_string) {
    this.data = data_string;
    return this;
  };

  this.noCarriage = function() {
    this.noCarriage = true;
    return this;
  };

  this.verify = function(pubkey, callback) {
    var start = new Date();
    var verified = false;
    var err = undefined;
    var sig = undefined;
    if(pubkey && !callback){
      callback = pubkey;
      pubkey = undefined;
    }
    // Do
    try{
      var signatures = openpgp.read_message(this.signature);
      sig = signatures[2];
      var verified = sig.verifySignature();
      if(!verified){
        err = "Signature does not match.";
      }
      if(verified){
        if(!sig.text){
          err = 'Signature does not contain text data';
          verified = false;
        }
        else{
          if(sig.text != this.data){
            err = "Signature does not match signed data.";
            verified = false;
          }
        }
      }
      if(verified && pubkey){
        var cert = this.certificate(pubkey);
        var issuer = hexstrdump(sig.signature.getIssuer()).toUpperCase();
        verified = cert.fingerprint.toUpperCase().indexOf(issuer) != -1;
        if(!verified){
          err = "Signature does not match issuer.";
        }
      }
    }
    catch(err){
      verified = false;
    }
    if(err && sig && sig.text){
      console.error('==========================================================');
      console.error(err);
      console.error('==========================================================');
      console.error(sig.text);
      console.error('----------------------------------------------------------');
      console.error(this.data);
      console.error('----------------------------------------------------------');
    }
    // Done
    var end = new Date();
    var diff = end.getTime() - start.getTime();
    // console.log("jpgp verify", diff + " ms");
    callback(err, verified);
  };


  // PRIVATE
  function hexstrdump(str) {
    if (str == null)
      return "";
    var r=[];
    var e=str.length;
    var c=0;
    var h;
    while(c<e){
        h=str[c++].charCodeAt().toString(16);
        while(h.length<2) h="0"+h;
        r.push(""+h);
    }
    return r.join('');
  };
}

module.exports = function () {
  return new JPGP();
};