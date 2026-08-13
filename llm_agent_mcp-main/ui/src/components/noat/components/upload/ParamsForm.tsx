import { useState } from 'react'
import { CheckboxField, SelectField, TextField } from '../ui/Field'
import type { ReconcileParams } from '../../api/types'

export interface ParamsFormState {
  toleranceAmount: number
  toleranceDays: number
  enableAi: boolean
  dateFrom: string
  dateTo: string
}

interface ParamsFormProps {
  initial?: Partial<ParamsFormState>
  disabled?: boolean
  onChange: (params: ParamsFormState) => void
}

const DEFAULT: ParamsFormState = {
  toleranceAmount: 5,
  toleranceDays: 1,
  enableAi: true,
  dateFrom: '',
  dateTo: '',
}

export function ParamsForm({ initial, disabled = false, onChange }: ParamsFormProps) {
  const [state, setState] = useState<ParamsFormState>({ ...DEFAULT, ...initial })

  const update = (patch: Partial<ParamsFormState>) => {
    const next = { ...state, ...patch }
    setState(next)
    onChange(next)
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <TextField
        label="Хүлцэлийн дүн (₮)"
        type="number"
        min={0}
        step="0.01"
        value={state.toleranceAmount}
        disabled={disabled}
        hint="Матаж таарахад зөвшөөрөх дүнгийн зөрүү"
        onChange={(e) => update({ toleranceAmount: Number(e.target.value) || 0 })}
      />
      <TextField
        label="Хүлцэлийн өдөр"
        type="number"
        min={0}
        max={30}
        step={1}
        value={state.toleranceDays}
        disabled={disabled}
        hint="Огнооны зөрүүний зөвшөөрөх хоног"
        onChange={(e) => update({ toleranceDays: Number(e.target.value) || 0 })}
      />
      <TextField
        label="Огноо — эхлэл"
        type="date"
        value={state.dateFrom}
        disabled={disabled}
        onChange={(e) => update({ dateFrom: e.target.value })}
      />
      <TextField
        label="Огноо — дуусах"
        type="date"
        value={state.dateTo}
        disabled={disabled}
        onChange={(e) => update({ dateTo: e.target.value })}
      />
      <div className="sm:col-span-2 lg:col-span-4">
        <CheckboxField
          label="AI матчинг идэвхжүүлэх"
          hint="Тохироогүй мөрүүдэд ухаалаг таарал санал болгоно (API тохируулсан бол)"
          checked={state.enableAi}
          disabled={disabled}
          onChange={(v) => update({ enableAi: v })}
        />
      </div>
    </div>
  )
}

export function toReconcileParams(p: ParamsFormState): ReconcileParams {
  return {
    toleranceAmount: p.toleranceAmount,
    toleranceDays: p.toleranceDays,
    enableAi: p.enableAi,
    dateFrom: p.dateFrom || undefined,
    dateTo: p.dateTo || undefined,
  }
}

export { SelectField }
