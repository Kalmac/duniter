"use strict";
const co      = require('co');
const _ = require('underscore');
const async		= require('async');
const request	= require('request');
const contacter = require('../../../app/modules/crawler').CrawlerDependency.duniter.methods.contacter;
const CommonConstants = require('../../../app/lib/common-libs/constants').CommonConstants
const ucp     = require('../../../app/lib/common-libs/buid').Buid
const parsers = require('../../../app/lib/common-libs/parsers').parsers
const rawer = require('../../../app/lib/common-libs').rawer
const keyring = require('../../../app/lib/common-libs/crypto/keyring')
const constants = require('../../../app/lib/constants');
const CertificationDTO = require('../../../app/lib/dto/CertificationDTO').CertificationDTO
const MembershipDTO = require('../../../app/lib/dto/MembershipDTO').MembershipDTO
const RevocationDTO = require('../../../app/lib/dto/RevocationDTO').RevocationDTO
const PeerDTO = require('../../../app/lib/dto/PeerDTO').PeerDTO
const TransactionDTO = require('../../../app/lib/dto/TransactionDTO').TransactionDTO

module.exports = function (uid, url, node) {
  return new User(uid, url, node);
};

function User (uid, options, node) {

  var that = this;
  var pub, sec;
  var createdIdentity = "";
  that.node = node;
  that.uid = uid

  // For sync code
  if (options.pub && options.sec) {
    pub = that.pub = options.pub;
    sec = that.sec = options.sec;
  }

  function init(done) {
    if (options.pub && options.sec) {
      pub = that.pub = options.pub;
      sec = that.sec = options.sec;
      done();
    } else {
      throw 'Not keypair information given for testing user ' + uid;
    }
  }

  this.createIdentity = (useRoot, fromServer) => co(function*() {
    if (!pub) {
      init(() => {})
    }
    const current = yield node.server.BlockchainService.current();
    let buid = !useRoot && current ? ucp.format.buid(current.number, current.hash) : '0-E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855';
    createdIdentity = rawer.getOfficialIdentity({
      buid: buid,
      uid: uid,
      issuer: pub,
      currency: node.server.conf.currency
    }, false);
    createdIdentity += keyring.KeyGen(pub, sec).signSync(createdIdentity) + '\n';
    yield that.submitIdentity(createdIdentity, fromServer);
  });

  this.submitIdentity = (raw, fromServer) => doPost('/wot/add', {
    "identity": raw
  }, fromServer);

  this.getIdentityRaw = () => createdIdentity;

  this.makeCert = (user, fromServer, overrideProps) => co(function*() {
    const lookup = yield that.lookup(user.pub, fromServer);
    const current = yield node.server.BlockchainService.current();
    const idty = _.filter(lookup.results[0].uids, (uidEntry) => uidEntry.uid === user.uid)[0]
    let buid = current ? ucp.format.buid(current.number, current.hash) : ucp.format.buid();
    const cert = {
      "version": constants.DOCUMENTS_VERSION,
      "currency": node.server.conf.currency,
      "issuer": pub,
      "idty_issuer": user.pub,
      "idty_uid": idty.uid,
      "idty_buid": idty.meta.timestamp,
      "idty_sig": idty.self,
      "buid": buid
    };
    _.extend(cert, overrideProps || {});
    const rawCert = rawer.getOfficialCertification(cert);
    cert.sig = keyring.KeyGen(pub, sec).signSync(rawCert, sec);
    return CertificationDTO.fromJSONObject(cert);
  });

  this.cert = (user, fromServer, toServer) => co(function*() {
    const cert = yield that.makeCert(user, fromServer);
    yield doPost('/wot/certify', {
      "cert": cert.getRawSigned()
    }, toServer);
  });

  this.join = () => co(function*() {
    return yield that.sendMembership("IN");
  });

  this.leave = () => co(function*() {
    return yield that.sendMembership("OUT");
  });

  this.makeRevocation = (givenLookupIdty, overrideProps) => co(function*() {
    const res = givenLookupIdty || (yield that.lookup(pub));
    const matchingResult = _.filter(res.results[0].uids, (uidEntry) => uidEntry.uid === uid)[0]
    const idty = {
      uid: matchingResult.uid,
      buid: matchingResult.meta.timestamp,
      sig: matchingResult.self
    }
    const revocation = {
      "currency": node.server.conf.currency,
      "issuer": pub,
      "uid": idty.uid,
      "sig": idty.sig,
      "buid": idty.buid,
      "revocation": ''
    };
    _.extend(revocation, overrideProps || {});
    const rawRevocation = rawer.getOfficialRevocation(revocation);
    revocation.revocation = keyring.KeyGen(pub, sec).signSync(rawRevocation);
    return RevocationDTO.fromJSONObject(revocation);
  });

  this.revoke = (givenLookupIdty) => co(function *() {
    const revocation = yield that.makeRevocation(givenLookupIdty);
    return post('/wot/revoke', {
      "revocation": revocation.getRaw()
    })
  });

  this.makeMembership = (type, fromServer, overrideProps) => co(function*() {
    const lookup = yield that.lookup(pub, fromServer);
    const current = yield node.server.BlockchainService.current();
    const idty = lookup.results[0].uids[0];
    const block = ucp.format.buid(current);
    const join = {
      "version": constants.DOCUMENTS_VERSION,
      "currency": node.server.conf.currency,
      "issuer": pub,
      "block": block,
      "membership": type,
      "userid": uid,
      "certts": idty.meta.timestamp
    };
    _.extend(join, overrideProps || {});
    const rawJoin = rawer.getMembershipWithoutSignature(join);
    join.signature = keyring.KeyGen(pub, sec).signSync(rawJoin);
    return MembershipDTO.fromJSONObject(join)
  });

  this.sendMembership = (type) => co(function*() {
    const ms = yield that.makeMembership(type);
    yield post('/blockchain/membership', {
      "membership": ms.getRawSigned()
    });
  });

  this.send = function (amount, recipient, comment) {
    return function(done) {
      return co(function *() {
        try {
          let raw = yield that.prepareITX(amount, recipient, comment);
          yield that.sendTX(raw);
          done();
        } catch (e) {
          done(e);
        }
      });
    };
  };

  this.sendMoney = function (amount, recipient, comment) {
    return co(function *() {
      let raw = yield that.prepareITX(amount, recipient, comment);
      yield that.sendTX(raw);
    })
  };

  this.sendTX = (rawTX) => co(function *() {
    let http = yield getContacter();
    return http.processTransaction(rawTX);
  });

  this.prepareUTX = (previousTX, unlocks, outputs, opts) => co(function *() {
    let obj = parsers.parseTransaction.syncWrite(previousTX);
    // Unlocks inputs with given "unlocks" strings
    let outputsToConsume = obj.outputs;
    if (opts.theseOutputsStart !== undefined) {
      outputsToConsume = outputsToConsume.slice(opts.theseOutputsStart);
    }
    let inputs = outputsToConsume.map((out, index) => {
      const output = TransactionDTO.outputStr2Obj(out);
      return {
        src: [output.amount, output.base, 'T', obj.hash, (opts.theseOutputsStart || 0) + index].join(':'),
        unlock: unlocks[index]
      };
    });
    return signed(that.prepareTX(inputs, outputs, opts));
  });

  this.prepareMTX = (previousTX, user2, unlocks, outputs, opts) => co(function *() {
    let obj = parsers.parseTransaction.syncWrite(previousTX);
    // Unlocks inputs with given "unlocks" strings
    let inputs = obj.outputs.map((out, index) => {
      const output = TransactionDTO.outputStr2Obj(out);
      return {
        src: [output.amount, output.base, 'T', obj.hash, index].join(':'),
        unlock: unlocks[index]
      };
    });
    opts = opts || {};
    opts.issuers = [pub, user2.pub];
    return signed(that.prepareTX(inputs, outputs, opts), user2);
  });

  this.prepareITX = (amount, recipient, comment) => co(function *() {
    let sources = [];
    if (!amount || !recipient) {
      throw 'Amount and recipient are required';
    }
    let http = yield getContacter();
    let current = yield http.getCurrent();
    let version = current && Math.min(CommonConstants.LAST_VERSION_FOR_TX, current.version);
    let json = yield http.getSources(pub);
    let i = 0;
    let cumulated = 0;
    let commonbase = null;
    while (i < json.sources.length) {
      let src = json.sources[i];
      sources.push({
        'type': src.type,
        'amount': src.amount,
        'base': src.base,
        'noffset': src.noffset,
        'identifier': src.identifier
      });
      if (commonbase == null) {
        commonbase = src.base;
      }
      commonbase = Math.min(commonbase, src.base);
      cumulated += src.amount * Math.pow(10, src.base);
      i++;
    }
    if (cumulated < amount) {
      throw 'You do not have enough coins! (' + cumulated + ' ' + node.server.conf.currency + ' left)';
    }
    let sources2 = [];
    let total = 0;
    for (let j = 0; j < sources.length && total < amount; j++) {
      let src = sources[j];
      total += src.amount * Math.pow(10, src.base);
      sources2.push(src);
    }
    let inputSum = 0;
    sources2.forEach((src) => inputSum += src.amount * Math.pow(10, src.base));
    let inputs = sources2.map((src) => {
      return {
        src: [src.amount, src.base].concat([src.type, src.identifier, src.noffset]).join(':'),
        unlock: 'SIG(0)'
      };
    });
    let outputs = [{
      qty: amount,
      base: commonbase,
      lock: 'SIG(' + (recipient.pub || recipient) + ')'
    }];
    if (inputSum - amount > 0) {
      // Rest back to issuer
      outputs.push({
        qty: inputSum - amount,
        base: commonbase,
        lock: "SIG(" + pub + ")"
      });
    }
    let raw = that.prepareTX(inputs, outputs, {
      version: version,
      blockstamp: current && [current.number, current.hash].join('-'),
      comment: comment
    });
    return signed(raw);
  });

  function signed(raw, user2) {
    let signatures = [keyring.KeyGen(pub, sec).signSync(raw)];
    if (user2) {
      signatures.push(keyring.KeyGen(user2.pub, user2.sec).signSync(raw));
    }
    return raw + signatures.join('\n') + '\n';
  }

  this.makeTX = (inputs, outputs, theOptions) => {
    const raw = that.prepareTX(inputs, outputs, theOptions);
    return signed(raw);
  };

  this.prepareTX = (inputs, outputs, theOptions) => {
    let opts = theOptions || {};
    let issuers = opts.issuers || [pub];
    let raw = '';
    raw += "Version: " + (opts.version || constants.TRANSACTION_VERSION) + '\n';
    raw += "Type: Transaction\n";
    raw += "Currency: " + (opts.currency || node.server.conf.currency) + '\n';
    raw += "Blockstamp: " + opts.blockstamp + '\n';
    raw += "Locktime: " + (opts.locktime || 0) + '\n';
    raw += "Issuers:\n";
    issuers.forEach((issuer) => raw += issuer + '\n');
    raw += "Inputs:\n";
    inputs.forEach(function (input) {
      raw += input.src + '\n';
    });
    raw += "Unlocks:\n";
    inputs.forEach(function (input, index) {
      if (input.unlock) {
        raw += index + ":" + input.unlock + '\n';
      }
    });
    raw += "Outputs:\n";
    outputs.forEach(function (output) {
      raw += [output.qty, output.base, output.lock].join(':') + '\n';
    });
    raw += "Comment: " + (opts.comment || "") + "\n";
    return raw;
  };

  this.makePeer = (endpoints, overrideProps) => co(function*() {
    const peer = PeerDTO.fromJSONObject({
      currency: node.server.conf.currency,
      pubkey: pub,
      block: '2-00008DF633FC158F9DB4864ABED696C1AA0FE5D617A7B5F7AB8DE7CA2EFCD4CB',
      endpoints: endpoints
    });
    _.extend(peer, overrideProps || {});
    const rawPeer = rawer.getPeerWithoutSignature(peer);
    peer.signature = keyring.KeyGen(pub, sec).signSync(rawPeer);
    return PeerDTO.fromJSONObject(peer)
  });

  function post(uri, data, done) {
    return new Promise((resolve, reject) => {
      var postReq = request.post({
        "uri": 'http://' + [node.server.conf.remoteipv4, node.server.conf.remoteport].join(':') + uri,
        "timeout": 1000 * 100000
      }, function (err, res, body) {
        err = err || (res.statusCode != 200 && body != 'Already up-to-date' && body) || null;
        if (err) {
          reject(err)
        } else {
          resolve(res, body)
        }
        done && done(err, res, body);
      });
      postReq.form(data);
    })
  }

  function doPost(uri, data, fromServer) {
    const ip = fromServer ? fromServer.conf.ipv4 : node.server.conf.remoteipv4;
    const port = fromServer ? fromServer.conf.port : node.server.conf.remoteport;
    return new Promise((resolve, reject) => {
      var postReq = request.post({
        "uri": 'http://' + [ip, port].join(':') + uri,
        "timeout": 1000 * 100000
      }, function (err, res, body) {
        err = err || (res.statusCode != 200 && body != 'Already up-to-date' && body) || null;
        err ? reject(err) : resolve(res);
      });
      postReq.form(data);
    });
  }

  function getContacter(fromServer) {
    return new Promise(function(resolve){
      let theNode = (fromServer && { server: fromServer }) || node;
      resolve(contacter(theNode.server.conf.ipv4, theNode.server.conf.port, {
        timeout: 1000 * 100000
      }));
    });
  }

  this.lookup = (pubkey, fromServer) => co(function*() {
    const node2 = yield getContacter(fromServer);
    return node2.getLookup(pubkey);
  });

  this.sendP = (amount, userid, comment) => new Promise((res, rej) => {
    that.send(amount, userid, comment)((err, data) => {
      if (err) return rej(err)
      res(data)
    })
  })
}
