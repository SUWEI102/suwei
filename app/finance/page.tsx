import { getFinanceData } from '@/app/actions/business'
import { FinanceLedger } from '@/components/finance-ledger'
export default async function Page(){return <FinanceLedger data={await getFinanceData()}/>}
