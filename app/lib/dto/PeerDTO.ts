import {DBPeer} from "../dal/sqliteDAL/PeerDAL"
import {hashf} from "../common"
import {CommonConstants} from "../common-libs/constants"
import {Cloneable} from "./Cloneable"

export interface WS2PEndpoint {
  uuid:string
  host:string
  port:number
}

export class PeerDTO implements Cloneable {

  clone(): any {
    return PeerDTO.fromJSONObject(this)
  }

  member = false

  constructor(
    public version:number,
    public currency:string,
    public pubkey:string,
    public blockstamp:string,
    public endpoints:string[],
    public signature:string,
    public status:string,
    public statusTS:number,
    member = false
  ) {
    this.member = member
  }

  get block() {
    return this.blockstamp
  }

  blockNumber() {
    return parseInt(this.blockstamp)
  }

  keyID() {
    return this.pubkey && this.pubkey.length > 10 ? this.pubkey.substring(0, 10) : "Unknown"
  }

  getRawUnsigned() {
    return this.getRaw()
  }

  getRaw() {
    let raw = ""
    raw += "Version: " + this.version + "\n"
    raw += "Type: Peer\n"
    raw += "Currency: " + this.currency + "\n"
    raw += "PublicKey: " + this.pubkey + "\n"
    raw += "Block: " + this.blockstamp + "\n"
    raw += "Endpoints:" + "\n"
    for(const ep of this.endpoints) {
      raw += ep + "\n"
    }
    return raw
  }

  getRawSigned() {
    return this.getRaw() + this.signature + "\n"
  }

  json() {
    return {
      version: this.version,
      currency: this.currency,
      endpoints: this.endpoints,
      status: this.status,
      block: this.block,
      signature: this.signature,
      raw: this.getRawSigned(),
      pubkey: this.pubkey
    }
  }

  getBMA() {
    let bma:any = null;
    this.endpoints.forEach((ep) => {
      const matches = !bma && ep.match(CommonConstants.BMA_REGEXP);
      if (matches) {
        bma = {
          "dns": matches[2] || '',
          "ipv4": matches[4] || '',
          "ipv6": matches[6] || '',
          "port": matches[8] || 9101
        };
      }
    });
    return bma || {};
  }

  getWS2P(canReachTorEp:boolean, canReachClearEp:boolean) {
    let api:{ uuid:string, host:string, port:number, path:string }|null = null
    const endpointRegexp = (canReachTorEp) ? CommonConstants.WS2PTOR_REGEXP:CommonConstants.WS2P_REGEXP
    for (const ep of this.endpoints) {
      if (canReachTorEp) {
        const matches:any = ep.match(CommonConstants.WS2PTOR_REGEXP)
        if (matches) {
          return {
            uuid: matches[1],
            host: matches[2] || '',
            port: parseInt(matches[3]) || 0,
            path: matches[4]
          }
        }
      }
      if (canReachClearEp) {
        const matches:any = !api && ep.match(CommonConstants.WS2P_REGEXP)
        if (matches) {
          api = {
            uuid: matches[1],
            host: matches[2] || '',
            port: parseInt(matches[3]) || 0,
            path: matches[4]
          }
        }
      }
    }
    return api || null
  }

  getDns() {
    const bma = this.getBMA();
    return bma.dns ? bma.dns : null;
  }

  getIPv4() {
    const bma = this.getBMA();
    return bma.ipv4 ? bma.ipv4 : null;
  }

  getIPv6() {
    const bma = this.getBMA();
    return bma.ipv6 ? bma.ipv6 : null;
  }

  getPort() {
    const bma = this.getBMA();
    return bma.port ? bma.port : null;
  }

  getHostPreferDNS() {
    const bma = this.getBMA();
    return (bma.dns ? bma.dns :
      (bma.ipv4 ? bma.ipv4 :
        (bma.ipv6 ? bma.ipv6 : '')))
  }

  getURL() {
    const bma = this.getBMA();
    let base = this.getHostPreferDNS();
    if(bma.port)
      base += ':' + bma.port;
    return base;
  }

  hasValid4(bma:any) {
    return !!(bma.ipv4 && !bma.ipv4.match(/^127.0/) && !bma.ipv4.match(/^192.168/))
  }

  getNamedURL() {
    return this.getURL()
  }

  isReachable() {
    return !!(this.getURL())
  }

  containsEndpoint(ep:string) {
    return this.endpoints.reduce((found:boolean, endpoint:string) => found || endpoint == ep, false)
  }

  containsAllEndpoints(endpoints:string[]) {
    for (const ep of endpoints) {
      if (!this.containsEndpoint(ep)) {
        return false
      }
    }
    return true
  }

  endpointSum() {
    return this.endpoints.join('_')
  }

  getHash() {
    return hashf(this.getRawSigned())
  }

  toDBPeer(): DBPeer {
    const p = new DBPeer()
    p.version  = this.version
    p.currency  = this.currency
    p.status  = this.status || "DOWN"
    p.statusTS  = this.statusTS || 0
    p.hash  = this.getHash()
    p.first_down  = 0
    p.last_try  = 0
    p.pubkey  = this.pubkey
    p.block  = this.block
    p.signature  = this.signature
    p.endpoints  = this.endpoints
    p.raw  = this.getRawSigned()
    return p
  }

  static blockNumber(blockstamp:string) {
    return parseInt(blockstamp)
  }

  static fromDBPeer(p:DBPeer) {
    return new PeerDTO(p.version, p.currency, p.pubkey, p.block, p.endpoints, p.signature, p.status, p.statusTS, false)
  }

  static fromJSONObject(obj:any) {
    return new PeerDTO(
      parseInt(obj.version),
      obj.currency || "",
      obj.pubkey || obj.pub || obj.issuer || "",
      obj.blockstamp || obj.block,
      obj.endpoints || [],
      obj.signature || obj.sig,
      obj.status || "DOWN",
      obj.statusTS || 0,
      obj.member
    )
  }

  static endpoint2host(endpoint:string) {
    return PeerDTO.fromJSONObject({ endpoints: [endpoint] }).getURL()
  }

  static indexOfFirst(endpoints:string[], intoEndpoints:string[]) {
    for (let i = 0; i < intoEndpoints.length; i++) {
      const index = endpoints.indexOf(intoEndpoints[i])
      if (index !== -1) {
        return index
      }
    }
    return 0
  }
}