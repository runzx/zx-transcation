/**
 * 翟享20220910 
 * 解决 mongodb 单机不能事务 
 */
import mongoose from "mongoose"

const { models, Types } = mongoose
const { ObjectId } = Types
export { ObjectId }

export const Status = {
  pending: 'Pending',
  success: 'Success',
  error: 'Error',
  rollback: 'Rollback',
  errRollback: 'ErrRollback',
}

export const Operation = {
  type: 'insert',  // 'insert', 'update', 'remove', 'increment'
  rollbackType: 'remove',  // execute for rollback type: 'remove', 'update', 'insert' ('increment' -> 'update')
  model: {},  // mongoose model instance
  modelName: 'User',  // mongoose model name
  oldModel: null, // 'mongoose model instance beforce transcation if exists',
  findId: 'xxx', // ObjectId
  data: {},
  options: {},  // query options, {new: false}
  status: Status.pending,
}

const { model, Schema } = mongoose
const { Mixed, Decimal128, } = Schema.Types
export { mongoose, model, }

const modelName = 'TransactionModel'

const schema = new Schema({
  operations: [],
  rollbackIndex: Number,
  status: String
})

export const TransactionModel = models[modelName] || model(modelName, schema)

export class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}
