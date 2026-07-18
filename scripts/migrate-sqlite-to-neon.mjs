import Database from 'better-sqlite3'
import pg from 'pg'

const { Pool } = pg
const SOURCE = new URL('../租赁数据/rental_data.db', import.meta.url).pathname
const TARGET_EMAIL = process.env.MIGRATION_TARGET_EMAIL || '625730448@qq.com'

if (!process.env.DATABASE_URL) throw new Error('缺少 DATABASE_URL')

const sqlite = new Database(SOURCE, { readonly: true })
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const dateOnly = (value, fallback) => {
  const text = String(value || fallback || '').trim()
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!match) throw new Error(`无法识别日期: ${text}`)
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}
const timestamp = (value) => value ? new Date(String(value).replace(' ', 'T')) : new Date()
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0
const text = (value) => value == null ? null : String(value)
const json = (value) => JSON.stringify(value ?? {}, null, 0)

async function migrate() {
  const client = await pool.connect()
  const summary = { rentalsInserted: 0, rentalsExisting: 0, itemsInserted: 0, paymentsInserted: 0, snapshotsInserted: 0, versionsInserted: 0, versionsExisting: 0 }
  try {
    await client.query('BEGIN')
    const userResult = await client.query('SELECT id FROM "user" WHERE lower(email)=lower($1)', [TARGET_EMAIL])
    if (userResult.rowCount !== 1) throw new Error(`目标账户未注册: ${TARGET_EMAIL}`)
    const userId = userResult.rows[0].id
    const sourceRows = sqlite.prepare('SELECT id, data, status, start_date, end_date, register_date, updated_at FROM rental_records ORDER BY id').all()
    const rentalIds = new Map()

    for (const source of sourceRows) {
      const record = JSON.parse(source.data)
      const renter = record.renter || {}
      const lease = record.lease_info || {}
      const hardware = record.hardware || {}
      const sourceItems = Array.isArray(hardware.items) && hardware.items.length ? hardware.items : [{}]
      const quantity = sourceItems.reduce((sum, item) => sum + Math.max(1, Math.trunc(number(item.quantity) || 1)), 0)
      const startDate = dateOnly(lease.start_date || source.start_date, record.register_date)
      const endDate = dateOnly(lease.end_date || source.end_date, startDate)
      const status = (record.status || source.status) === '已逾期' ? '逾期' : (record.status || source.status || '在租')
      const paidAmount = number(record.paid_amount)
      const totalRent = number(lease.total_rent)
      const paymentStatus = paidAmount <= 0 ? '待收款' : paidAmount >= totalRent && totalRent > 0 ? '已收款' : '部分收款'
      const mismatch = record.quantity && number(record.quantity) !== quantity ? `旧汇总数量 ${record.quantity} 与设备明细数量 ${quantity} 不一致，迁移采用设备明细。` : ''
      const migrationNote = ['由旧版 SQLite 自动迁移。', mismatch, hardware.notes].filter(Boolean).join(' ')
      const first = sourceItems[0]
      const config = record.hardware_summary || [first.cpu, first.motherboard, first.ram, first.disk, first.gpu].filter(Boolean).join(' / ') || '未填写'
      const values = [userId, source.id, renter.name || '未填写客户', renter.phone || '未填写', renter.address || null, first.device_type || '未填写设备', first.device_type || '其他', config, quantity, startDate, endDate, number(lease.monthly_rent), totalRent, number(lease.deposit), paidAmount, paymentStatus, status, migrationNote, timestamp(record.register_date || source.register_date), timestamp(source.updated_at)]
      let inserted = await client.query(`INSERT INTO rentals ("userId","contractNo","customerName","customerPhone","customerAddress","deviceName","deviceType","deviceConfig",quantity,"startDate","endDate","monthlyRent","totalRent",deposit,"paidAmount","paymentStatus",status,notes,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT ("userId","contractNo") DO NOTHING RETURNING id`, values)
      let rentalId
      if (inserted.rowCount) { rentalId = inserted.rows[0].id; summary.rentalsInserted++ }
      else { rentalId = (await client.query('SELECT id FROM rentals WHERE "userId"=$1 AND "contractNo"=$2', [userId, source.id])).rows[0].id; summary.rentalsExisting++ }
      rentalIds.set(source.id, rentalId)

      const itemCount = await client.query('SELECT count(*)::int AS count FROM rental_items WHERE "userId"=$1 AND "rentalId"=$2', [userId, rentalId])
      if (itemCount.rows[0].count === 0) {
        for (const item of sourceItems) {
          const itemQuantity = Math.max(1, Math.trunc(number(item.quantity) || 1))
          const unitRent = number(item.unit_rent || lease.monthly_rent)
          const itemConfig = [item.cpu, item.motherboard, item.ram, item.disk, item.gpu, item.notes].filter(Boolean).join(' / ') || '未填写'
          await client.query(`INSERT INTO rental_items ("userId","rentalId","deviceName","deviceType","deviceConfig",quantity,"startDate","endDate","monthlyRent","totalRent",cpu,motherboard,memory,storage,"graphicsCard") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [userId, rentalId, item.device_type || '未填写设备', item.device_type || '其他', itemConfig, itemQuantity, startDate, endDate, unitRent, unitRent * itemQuantity, text(item.cpu || hardware.cpu), text(item.motherboard), text(item.ram || hardware.ram), text(item.disk || hardware.disk), text(item.gpu || hardware.gpu)])
          summary.itemsInserted++
        }
      }

      if (paidAmount > 0) {
        const note = source.id === 'R20260612104352' ? '由旧版累计已收金额迁移' : `旧版历史导入:${source.id}`
        const exists = await client.query('SELECT 1 FROM payment_records WHERE "userId"=$1 AND "rentalId"=$2 AND notes=$3', [userId, rentalId, note])
        if (!exists.rowCount) {
          await client.query('INSERT INTO payment_records ("userId","rentalId","operatorName",amount,"paymentDate","paymentMethod","feeType",notes,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [userId, rentalId, '旧版数据迁移', paidAmount, dateOnly(record.register_date || source.register_date), '历史导入', '租金', note, timestamp(record.register_date || source.register_date)])
          summary.paymentsInserted++
        }
      }

      const snapshot = await client.query(`INSERT INTO contract_snapshots ("userId","rentalId","customerType","customerIdentityNo","lessorJson","customerJson","itemsJson",terms,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT ("rentalId") DO NOTHING RETURNING id`, [userId, rentalId, '个人', renter.id_card || null, '{}', json(renter), json(sourceItems), '沿用旧版租赁记录约定，详细原始数据已归档。', timestamp(record.register_date || source.register_date), timestamp(source.updated_at)])
      if (snapshot.rowCount) summary.snapshotsInserted++
    }

    const versions = sqlite.prepare('SELECT version_id, record_id, action, data, created_at, note FROM record_versions ORDER BY version_id').all()
    for (const version of versions) {
      const rentalId = rentalIds.get(version.record_id)
      if (!rentalId) throw new Error(`历史版本找不到合同: ${version.record_id}`)
      const result = await client.query(`INSERT INTO legacy_record_versions ("userId","rentalId","sourceRecordId","sourceVersionId",action,"snapshotJson","sourceCreatedAt",notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("userId","sourceVersionId") DO NOTHING RETURNING id`, [userId, rentalId, version.record_id, version.version_id, version.action, version.data || '{}', timestamp(version.created_at), version.note])
      if (result.rowCount) summary.versionsInserted++; else summary.versionsExisting++
    }
    await client.query('COMMIT')
    console.log(JSON.stringify({ targetEmail: TARGET_EMAIL, sourceRentals: sourceRows.length, sourceVersions: versions.length, ...summary }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release(); sqlite.close(); await pool.end()
  }
}

migrate().catch((error) => { console.error(error); process.exitCode = 1 })
