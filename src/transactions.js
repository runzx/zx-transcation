/**
 * 翟享20220910 
 * 解决 mongodb 单机不能事务 
 */
import mongoose, { models } from "mongoose"

export const Status = {
  pending: 'Pending',
  success: 'Success',
  error: 'Error',
  rollback: 'Rollback',
  errRollback: 'ErrRollback',
}

export const Operation = {
  type: 'transaction type string',
  rollbackType: 'execute for rollback type',
  model: 'object mongoose model instance',
  modelName: 'mongoose model name',
  oldModel: null, // 'mongoose model instance beforce transcation if exists',
  findId: 'The _id of the Doc',
  data: 'any The data',
  options: {},  // 'any query options',
  status: Status.pending,
}

const { model, Schema } = mongoose
const { Mixed, ObjectId, Decimal128, } = Schema.Types
export { mongoose, model, ObjectId }

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
