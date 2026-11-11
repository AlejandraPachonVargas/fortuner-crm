import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null; key?: string }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }
  static getDerivedStateFromError(error: Error) { return { error } }
  static getDerivedStateFromProps(p: Props, s: State) { return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="m-6 rounded-xl border border-bad/30 bg-bad-soft p-5 text-bad">
        <div className="text-[15px] font-bold">Algo salió mal en esta pantalla</div>
        <p className="mt-1 text-[13px]">Recargue la página. Si el problema continúa, avise al equipo de sistemas.</p>
        <button type="button" onClick={() => location.reload()} className="mt-3 rounded-lg border border-current/30 px-3 py-1.5 text-[13px] font-semibold">Recargar</button>
      </div>
    )
  }
}
