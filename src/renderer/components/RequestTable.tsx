import type { RequestRecord } from "../types";

interface Props {
  requests: RequestRecord[];
}

export function RequestTable({ requests }: Props) {
  return (
    <section className="panel request-panel">
      <div className="panel-header">
        <div>
          <h2>最近请求</h2>
          <p>模型、状态、耗时、token 和缓存命中</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>模型</th>
              <th>状态</th>
              <th>耗时</th>
              <th>Token</th>
              <th>流式</th>
              <th>缓存</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>{new Date(request.timestamp).toLocaleTimeString("zh-CN")}</td>
                <td><span className="mono">{request.model}</span></td>
                <td><span className={`status ${request.status}`}>{request.status}</span></td>
                <td>{request.durationMs}ms</td>
                <td>{request.totalTokens}</td>
                <td>{request.stream ? "是" : "否"}</td>
                <td>{request.responseCacheHit == null ? "—" : request.responseCacheHit ? "hit" : "miss"}</td>
                <td>{request.errorCode || "—"}</td>
              </tr>
            ))}
            {!requests.length && (
              <tr><td colSpan={8} className="empty">还没有请求记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
