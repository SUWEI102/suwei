import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import * as schema from './schema'

const requiredEnv = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'] as const

for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`${key} 未配置`)
}

export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5,
  enableKeepAlive: true,
  ssl: process.env.MYSQL_SSL === 'false' ? undefined : { rejectUnauthorized: true },
})

export const db = drizzle({ client: pool, schema, mode: 'default' })
