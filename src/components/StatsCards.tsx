import { useMemo } from "react";
import { Button, Card, Col, Row, Space, Statistic } from "antd";
import { AimOutlined, FundViewOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { useAppStore } from "../store";
import { computeStats } from "../stats";
import type { MainView } from "../types";

const items: {
  title: string;
  get: (s: NonNullable<ReturnType<typeof computeStats>>) => number;
  precision: number;
}[] = [
  { title: "样本数", get: (s) => s.n, precision: 0 },
  { title: "均值 (m/s)", get: (s) => s.mean, precision: 4 },
  { title: "最大值", get: (s) => s.max, precision: 3 },
  { title: "最小值", get: (s) => s.min, precision: 3 },
  { title: "极差", get: (s) => s.range, precision: 3 },
  { title: "方差 (样本)", get: (s) => s.variance, precision: 6 },
  { title: "标准差 (样本)", get: (s) => s.std, precision: 4 },
];

interface StatsCardsProps {
  view: MainView;
  onChangeView: (view: MainView) => void;
}

export default function StatsCards({ view, onChangeView }: StatsCardsProps) {
  const groups = useAppStore((s) => s.groups);
  const viewingGroupId = useAppStore((s) => s.viewingGroupId);
  const group = groups.find((g) => g.id === viewingGroupId) ?? null;

  const stats = useMemo(
    () => computeStats(group ? group.shots.map((s) => s.speed_mps) : []),
    [group]
  );

  return (
    <Card
      size="small"
      title={group ? `统计 — ${group.name}` : "统计"}
      data-tour="stats-cards"
      extra={
        <Space size={8}>
          <Button
            size="small"
            data-tour="view-details"
            icon={<UnorderedListOutlined />}
            disabled={!group || group.shots.length === 0}
            onClick={() =>
              onChangeView(view === "details" ? "charts" : "details")
            }
          >
            {view === "details" ? "收起明细" : "查看明细"}
          </Button>
          <Button
            size="small"
            data-tour="view-dispersion"
            icon={<AimOutlined />}
            onClick={() =>
              onChangeView(view === "dispersion" ? "charts" : "dispersion")
            }
          >
            {view === "dispersion" ? "收起散布分析" : "散布分析"}
          </Button>
          <Button
            size="small"
            data-tour="view-overview"
            icon={<FundViewOutlined />}
            disabled={groups.length === 0}
            onClick={() => onChangeView(view === "overview" ? "charts" : "overview")}
          >
            {view === "overview" ? "收起测试总览" : "测试总览"}
          </Button>
        </Space>
      }
    >
      <Row gutter={12}>
        {items.map((it) => (
          <Col flex="1 1 0" key={it.title} style={{ minWidth: 100 }}>
            <Statistic
              title={it.title}
              value={stats ? it.get(stats) : "-"}
              precision={it.precision}
              valueStyle={{ fontSize: 20, fontVariantNumeric: "tabular-nums" }}
            />
          </Col>
        ))}
      </Row>
    </Card>
  );
}
