# mongoose 单机 实现 事务处理

1. 主要可靠实现 create, increment, remove
2. 此流程不能锁表, update 在并发时 rollback 回滚 后可能数据不正确 (update 出错到回滚间如并发有修改操作，则会丢失此部分)
3. 事务流程可以记录 在数据库中(`TransactionModel`), 可通过此回滚
4. modelName 集合要先定义

```js
// test/demo.js
import { Transaction, mongoose, Schema } from "../src/index.js"
const User = mongoose.model(
  "User", // modelName
  new Schema({ name: String, age: Number, points: Number })
)

const uri = "mongodb://centos7:27017/demo"
mongoose.connect(uri, null, () => console.log("mongoose connect:" + uri))
mongoose.connection.on("error", (err) => console.error(err))

const useDB = false
const t = new Transaction(useDB) // false 不记录 事务流程 在数据库中

const zxId = t.insert("User", { name: "zx" })
const mmId = t.insert("User", { name: "mm" })

t.increment("User", zxId, { points: 100 })
t.increment("User", zxId, { points: "-20" })
t.increment("User", mmId, { points: "20.0" })
t.increment("User", "flakId", { points: "-20" })
try {
  t.run()
} catch (e) {
  t.rollback()
}
```

### 从数据库中取记录 重新执行 或 回滚

```js
import { Transaction, mongoose, Schema } from "../src/index.js"
const User = mongoose.model(
  "User",
  new Schema({ name: String, age: Number, points: Number })
)

const uri = "mongodb://centos7:27017/demo"
mongoose.connect(uri, null, () => console.log("mongoose connect:" + uri))
mongoose.connection.on("error", (err) => console.error(err))

async function start() {
  const t = new Transaction(true)
  let res = await t.loadDbTransaction("631c84a3100479a55b692400")
  try {
    res = await t.run()
  } catch (e) {
    res = await t.rollback()
  }
  console.log(res)
}
start()

// 事务记录
const transaction = new Transaction(true)
const transId = await transaction.getTransactionId()
// 保存 记录
const transId = await transaction.saveOperations()
// 读取 记录
await transaction.loadDbTransaction(transId)
```

### operation

```js
Operation = {
  type: "insert", // 'insert', 'update', 'remove', 'increment'
  rollbackType: "remove", // execute for rollback type: 'remove', 'update', 'insert' ('increment' -> 'update')
  model: {}, // mongoose model instance
  modelName: "User", // mongoose model name
  oldModel: null, // 'mongoose model instance beforce transcation if exists',
  findId: "xxx", // ObjectId
  data: {},
  options: {}, // query options, {new: false}
  status: Status.pending,
}

Status = ["Pending", "Success", "Error", "Rollback", "ErrRollback"]
```

### 参考

1. ["mongoose-transactions"](https://github.com/daton89-topperblues/mongoose-transactions)
