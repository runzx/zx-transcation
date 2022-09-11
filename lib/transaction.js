/**
 * 翟享20220910 
 * 解决 mongodb 单机不能事务 
 * increment 可以在并发增加计算中 rollback 原始数据; data 里值 一定要能转为数值
 * update 如果在此流程中有其它并发修改操作，rollback可能不正确
 */
import mongoose from "mongoose"

const { models, Types, model, Schema } = mongoose
const { ObjectId } = Types
export { mongoose, model, ObjectId, Schema }

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

const schema = new Schema({
  operations: [],
  rollbackIndex: Number,
  status: String
})

export const TransactionModel = models['TransactionModel'] || model('TransactionModel', schema)

export class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
  }
}

export class Transaction {
  rollbackIndex = 0
  useDb = false
  transactionId = ''
  operations = []

  constructor(useDb) {
    this.useDb = useDb
  }

  insert(modelName, { _id, ...data }, options = {}) {
    const model = mongoose.model(modelName)
    if (!_id) _id = new ObjectId()
    this.operations.push({
      rollbackType: 'remove', type: 'insert',
      findId: _id, data: { _id, ...data }, model, modelName, options,
      oldModel: null, status: Status.pending
    })
    return _id
  }

  update(modelName, findId, data, options = {}) {
    const model = mongoose.model(modelName)
    const operation = {
      rollbackType: 'update', type: 'update',
      findId, data, model, modelName, options,
      oldModel: null, status: Status.pending
    }
    this.operations.push(operation)
    return operation
  }
  // $inc 增加计算; data: {prop1: num}
  increment(modelName, findId, data, options = {}) {
    const model = mongoose.model(modelName)
    let flag = false, err = [], _data = {}
    Object.entries(data).forEach(([key, value]) => {
      if (isNaN(value)) {
        flag = true
        const msg = `data[${key}] isNaN: ${value}`
        err.push(msg)
        console.log(msg)
      } else {
        data[key] = +value
        _data[key] = -value
      }
    })
    if (flag) throw new Error(err.join(';'))
    const operation = {
      rollbackType: 'update', type: 'increment',
      findId, data, model, modelName, options, _data,
      oldModel: null, status: Status.pending
    }
    this.operations.push(operation)
    return operation
  }

  remove(modelName, findId, options = {}) {
    const model = mongoose.model(modelName)
    const operation = {
      rollbackType: 'insert', type: 'remove',
      findId, data: null, model, modelName, options,
      oldModel: null, status: Status.pending
    }
    this.operations.push(operation)
    return operation
  }

  async run() {
    if (this.useDb && this.transactionId === '') await this.createTransaction()
    const final = []

    return this.operations.reduce(
      (promise, transaction, index) => promise.then(async res => {
        let operation
        const { type, model, data, findId, options } = transaction
        switch (type) {
          case 'insert':
            operation = this.insertTransaction(model, data)
            break;
          case 'update':
            operation = this.findByIdTransaction(model, findId).then(findRes => {
              transaction.oldModel = findRes
              return this.updateTransaction(model, findId, data, options)
            })
            break;
          case 'remove':
            operation = this.findByIdTransaction(model, findId).then(findRes => {
              transaction.oldModel = findRes
              return this.removeTransaction(model, findId)
            })
            break;
          case 'increment':
            transaction.oldModel = { $inc: transaction._data }
            operation = this.updateTransaction(model, findId, { $inc: data }, options)
            break;
        }
        return operation.then(async query => {
          this.rollbackIndex = index
          this.updateOperationStatus(Status.success, index)
          if (index === this.operations.length - 1) await this.updateDbTransaction(Status.success)
          final.push(query)
          return final
        }).catch(async err => {
          this.updateOperationStatus(Status.error, index)
          await this.updateDbTransaction(Status.error)
          throw err
        })
      })
      , Promise.resolve([])
    )
  }

  async createTransaction() {
    if (!this.useDb) throw new Error('must set useDB true ')
    const tx = await TransactionModel.create({ operations: this.operations, rollbackIndex: this.rollbackIndex })
    this.transactionId = tx._id
    return tx
  }

  insertTransaction(model, data) {
    const { promise, resolve, reject } = new Deferred()
    model.create(data, (err, res) => {
      if (err) reject(this.transactionError(err))
      else resolve(res)
    })
    return promise
  }
  transactionError(error, data) {
    return {
      data, error,
      executedTransactions: this.rollbackIndex + 1,
      remainingTransactions: this.operations.length - (this.rollbackIndex + 1)
    }
  }
  async findByIdTransaction(model, findId) {
    return await model.findById(findId)
      .lean() // 返回的文档是普通 javascript 对象
      .exec()
  }
  updateTransaction(model, id, data, options = { new: false }) {
    const { promise, resolve, reject } = new Deferred()
    model.findByIdAndUpdate(id, data, options, (err, res) => {
      if (err) reject(this.transactionError(err))
      else {
        if (!res) reject(this.transactionError(new Error('Entity not found'), { id, data }))
        else resolve(res)
      }
    })
    return promise
  }
  removeTransaction(model, id) {
    const { promise, resolve, reject } = new Deferred()
    model.findByIdAndRemove(id, (err, res) => {
      if (err) return reject(this.transactionError(err, { id }))
      if (res === null) return reject(this.transactionError(new Error('Entity not found'), { id, }))
      resolve(res)
    })
    return promise
  }
  updateOperationStatus(status, index) {
    this.operations[index].status = status
  }
  async updateDbTransaction(status) {
    if (this.useDb && this.transactionId !== '') {
      return await TransactionModel.findByIdAndUpdate(this.transactionId,
        {
          operations: this.operations,
          rollbackIndex: this.rollbackIndex,
          status
        }, { new: true })
    }
  }

  async rollback(howmany = this.rollbackIndex + 1) {
    if (this.useDb && this.transactionId === '') await this.createTransaction()

    let transactionToRollback = this.operations.slice(0, this.rollbackIndex + 1)
    transactionToRollback.reverse()

    if (howmany !== this.rollbackIndex + 1) {
      transactionToRollback = transactionToRollback.slice(0, howmany)
    }
    const final = []

    return transactionToRollback.reduce(
      (promise, transaction, index) => promise.then(res => {
        let operation
        const { rollbackType, oldModel, type, model, data, findId, options } = transaction
        switch (rollbackType) {
          case 'insert':
            operation = this.insertTransaction(model, oldModel)
            break;
          case 'update':
            operation = this.updateTransaction(model, findId, oldModel)
            break;
          case 'remove':
            operation = this.removeTransaction(model, findId)
            break;
          // case 'increment':
          //   operation = this.updateTransaction(model, findId, { $inc: data }, options)
          //   break;
        }
        return operation.then(async query => {
          this.rollbackIndex--
          this.updateOperationStatus(Status.rollback, index)
          if (index === this.operations.length - 1) await this.updateDbTransaction(Status.rollback)
          final.push(query)
          return final
        }).catch(async err => {
          this.updateOperationStatus(Status.errRollback, index)
          await this.updateDbTransaction(Status.errRollback)
          throw err
        })
      })
      , Promise.resolve([])
    )
  }

  async clean() {
    this.operations = []
    this.rollbackIndex = 0
    this.transactionId = ''
    if (this.useDb) await this.createTransaction()
  }

  async saveOperations() {
    if (this.transactionId === '') await this.createTransaction()
    await TransactionModel.findByIdAndUpdate(this.transactionId, { operations: this.operations, rollbackIndex: this.rollbackIndex })
    return this.transactionId
  }

  async getOperations(transactionId = null) {
    if (transactionId)
      return await TransactionModel.findById(transactionId).lean().exec()
    return this.operations
  }

  async getTransactionId() {
    if (this.transactionId === '') await this.createTransaction()
    return this.transactionId
  }

  async removeDbTransaction(transactionId = null) {
    try {
      if (transactionId === null) await TransactionModel.deleteMany({})
      else await TransactionModel.findByIdAndRemove(transactionId)
    } catch (err) { throw new Error('Fail remove transaction[s] in removeDbTransaction') }
  }

  async loadDbTransaction(transactionId) {
    const loadedTransaction = await TransactionModel.findById(transactionId).lean()
    if (!loadedTransaction) return null
    loadedTransaction.operations.forEach(operation => {
      operation.model = mongoose.model(operation.modelName)
    })
    this.operations = loadedTransaction.operations
    this.rollbackIndex = loadedTransaction.rollbackIndex
    this.transactionId = transactionId
    return loadedTransaction
  }
}