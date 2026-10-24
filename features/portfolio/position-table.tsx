import Link from 'next/link';
import { money, symbolColor, type Position } from './model';
export function PositionTable({ positions }: { positions: Position[] }) {
  if (!positions.length)
    return (
      <div className="empty-state">
        <h2>No positions in this view</h2>
        <p>An empty account is valid. This does not imply missing assets have zero value.</p>
        <Link href="/portfolio">Return to sample overview →</Link>
      </div>
    );
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label="Scrollable simulated holdings table"
    >
      <table>
        <caption>Simulated holdings · USD values · all quantities invented</caption>
        <thead>
          <tr>
            <th scope="col">Asset / position</th>
            <th scope="col">Network</th>
            <th scope="col">Type</th>
            <th scope="col">Quantity</th>
            <th scope="col">Sample value</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((item) => (
            <tr key={item.id}>
              <th scope="row">
                <span
                  className="asset-icon"
                  style={{ background: symbolColor(item.symbol) }}
                  aria-hidden="true"
                >
                  {item.symbol[0]}
                </span>
                {item.symbol}
              </th>
              <td>{item.network}</td>
              <td>
                <span className="type-label">{item.kind}</span>
              </td>
              <td>{item.quantity}</td>
              <td className={item.kind === 'Debt' ? 'debt' : ''}>
                {item.kind === 'Debt' ? '−' : ''}
                {money(item.valueCents)}
                {item.valueCents === null && <small className="muted">Price unavailable</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
