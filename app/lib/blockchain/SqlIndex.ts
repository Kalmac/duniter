"use strict"
import {IndexOperator} from "./interfaces/IndexOperator"
import * as _ from "underscore"

const IndexDAL = require('../dal/sqliteDAL/IndexDAL')

export class SQLIndex implements IndexOperator {

  private indexes: { [k:string]: any } = {}

  constructor(private db, private definitions: any) {
  }

  async initIndexer(pkFields: any): Promise<void> {
    const keys = _.keys(pkFields)
    for (const k of keys) {
      if (this.definitions[k].handler) {
        // External table: managed by another object
        this.indexes[k] = this.definitions[k].handler
      } else {
        // Internal table: managed here
        const indexTable = new IndexDAL(this.db);
        const pk = pkFields[k].pk
        indexTable.table = k
        indexTable.fields = this.definitions[k].fields
        indexTable.booleans = this.definitions[k].booleans
        this.indexes[k] = indexTable
        indexTable.init = () => {
          return indexTable.exec('BEGIN;' +
            'CREATE TABLE IF NOT EXISTS ' + indexTable.table + ' (' +
            this.definitions[k].sqlFields.join(',') +
            ');' +
            'COMMIT;', [])
        }
        await indexTable.init()
      }
    }
  }

  getSubIndexes(): Promise<string[]> {
    return Promise.resolve(_.keys(this.indexes))
  }

  findTrimable(subIndex: string, numberField: string, maxNumber: number): Promise<any[]> {
    if (this.definitions[subIndex].findTrimable) {
      return this.definitions[subIndex].findTrimable(maxNumber)
    } else {
      const criterias = {}
      criterias[numberField] = { $lt: maxNumber }
      return this.indexes[subIndex].sqlFind(criterias)
    }
  }

  removeWhere(subIndex: string, criterias: {}): Promise<void> {
    if (!this.indexes[subIndex]) {
      return Promise.resolve()
    }
    return this.indexes[subIndex].sqlRemoveWhere(criterias)
  }

  async recordIndex(index: any): Promise<void> {
    const subIndexes = _.keys(index)
    // Feed the this.indexes
    for (const subIndex of subIndexes) {
      await this.indexes[subIndex].insertBatch(index[subIndex])
    }
    return Promise.resolve()
  }


  findWhere(subIndex: string, criterias: {}): Promise<any[]> {
    if (!this.indexes[subIndex]) {
      return Promise.resolve([])
    }
    return this.indexes[subIndex].sqlFind(criterias)
  }
}