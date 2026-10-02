/**
 * 内置使用指南：分步高亮引导（antd Tour）+ 首次启动欢迎框 + 常驻入口。
 *
 * 步骤锚点写在界面元素的 data-tour 属性上；打开引导时找不到锚点的步骤会被跳过，
 * 所以任何界面状态下引导都不会卡住。
 */
import { useCallback, useEffect, useState } from "react";
import { Button, Dropdown, Modal, Tour, Typography, message } from "antd";
import type { MenuProps, TourProps } from "antd";
import {
  CompassOutlined,
  DeleteOutlined,
  DownloadOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { addDemoProject, demoTestIds, removeDemoProject } from "./demo";
import { useAppStore } from "./store";
import type { MainView } from "./types";

const { Text } = Typography;

export const ONBOARDED_KEY = "rm-chrono-onboarded";

/** 已经看过引导（存储不可用时按已看过处理，避免每次都弹） */
export function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // 存储失败不影响使用
  }
}

/** 取某一步的高亮目标 */
export function tourTarget(anchor: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
}

export interface TourStepDef {
  key: string;
  /** 该步需要哪个主区视图（缺省为图表页） */
  view: MainView;
  /** 高亮目标的 data-tour 值；不填 = 居中说明，不高亮任何元素 */
  anchor?: string;
  title: string;
  description: React.ReactNode;
  placement?: TourProps["placement"];
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <div style={{ marginTop: 6 }}>
    <Text type="secondary" style={{ fontSize: 12 }}>
      {children}
    </Text>
  </div>
);

export const TOUR_STEPS: TourStepDef[] = [
  {
    key: "welcome",
    view: "charts",
    title: "欢迎使用测速模块上位机",
    description: (
      <div>
        <div>这套工具给发射机构做弹速与摩擦轮测试，一共四块：</div>
        <ul style={{ paddingLeft: 18, margin: "6px 0" }}>
          <li>连测速模块，逐发记弹速</li>
          <li>连波形口，看六个摩擦轮的掉速与恢复</li>
          <li>靶纸散布分析（R50 / 平均环数）</li>
          <li>多组对比、测试总览与导出</li>
        </ul>
        <Hint>走完约 1 分钟；随时点右上角「使用指南」重看。</Hint>
      </div>
    ),
  },
  {
    key: "conn-serial",
    view: "charts",
    anchor: "conn-serial",
    placement: "bottomLeft",
    title: "① 连接测速模块",
    description: (
      <div>
        <div>选好串口再点「连接」。测速口协议固定 115200，不用设波特率。</div>
        <Hint>右侧「在线 / 离线」按 500 ms 无数据判断；「帧 · 跳 · CRC」是累计计数。</Hint>
      </div>
    ),
  },
  {
    key: "conn-demo",
    view: "charts",
    anchor: "conn-demo",
    placement: "bottom",
    title: "② 手边没有硬件？打开「模拟数据」",
    description: (
      <div>
        <div>
          会生成一路模拟弹速帧与波形数据，界面行为跟真实连接完全一样，
          用来先熟悉功能很合适。
        </div>
        <Hint>关掉开关即停止模拟，模拟期间不会动你的真实数据。</Hint>
      </div>
    ),
  },
  {
    key: "conn-wave",
    view: "charts",
    anchor: "conn-wave",
    placement: "bottom",
    title: "③ 波形口：摩擦轮转速（VOFA+ JustFloat）",
    description: (
      <div>
        <div>
          这是第二路串口，接摩擦轮转速。选口、选波特率、连接，
          之后每一发都会自动存下发射前后的转速曲线。
        </div>
        <Hint>不接波形口也能记弹速，只是没有掉速分析。</Hint>
      </div>
    ),
  },
  {
    key: "conn-wave-settings",
    view: "charts",
    anchor: "conn-wave-settings",
    placement: "bottomRight",
    title: "④ 通道分配：哪几个通道是哪个轮子",
    description: (
      <div>
        <div>
          点齿轮打开波形通道设置：分几组（如一级 3 个 + 二级 3 个）、
          每组占哪些通道、每个通道显示什么名字。
        </div>
        <Hint>不接调试器也能手动指定通道数；分配会跟着每一组数据一起存进文件。</Hint>
      </div>
    ),
  },
  {
    key: "live-speed",
    view: "charts",
    anchor: "live-speed",
    placement: "right",
    title: "⑤ 实时弹速",
    description: (
      <div>
        <div>每来一发就刷新：大字是弹速，下面一行是 dt（两光电门时间差）与距上一发的间隔。</div>
        <Hint>曲线/列表都来自这些帧，落盘是自动的（静止 2 s 即存）。</Hint>
      </div>
    ),
  },
  {
    key: "group-list",
    view: "charts",
    anchor: "group-list",
    placement: "right",
    title: "⑥ 测试 → 组：两层结构",
    description: (
      <div>
        <div>
          左侧是两层：<Text strong>测试</Text>是一次实验（带日期时间），
          <Text strong>组</Text>是其中的一种工况。比如一次实验里试了四种参数，
          就建一个测试、四个组。
        </div>
        <Hint>在测试/组上点右键：重命名、编辑备注、导出该组明细 CSV、删除。</Hint>
      </div>
    ),
  },
  {
    key: "test-toolbar",
    view: "charts",
    anchor: "test-toolbar",
    placement: "right",
    title: "⑦ 新建 / 导入 / 导出 / 清理",
    description: (
      <div>
        <div>
          ＋ 新建测试；导入 .rmtest 会变成新测试；导出全部测试；
          闪电图标清理历史波形快照（只删曲线，弹速和参数都留着）。
        </div>
        <Hint>导入是「合并」，不会覆盖你已有的数据。</Hint>
      </div>
    ),
  },
  {
    key: "group-params",
    view: "charts",
    anchor: "group-params",
    placement: "right",
    title: "⑧ 工况参数与开始记录",
    description: (
      <div>
        <div>
          按次序填：一级转速、二级转速、PID、压缩量、摩擦轮硬度、备注，
          再点「开始新组」。这批参数会跟着这一组一起存进文件，导出时一并带出。
        </div>
        <Hint>打够右上角「目标发数」会亮绿提示，之后「结束本组」。</Hint>
      </div>
    ),
  },
  {
    key: "stats-cards",
    view: "charts",
    anchor: "stats-cards",
    placement: "bottom",
    title: "⑨ 统计卡与三个视图",
    description: (
      <div>
        <div>
          样本数、均值、最大/最小、极差、方差、标准差（
          <Text strong>样本口径</Text>，与 Excel 的 STDEV.S 一致）。
        </div>
        <Hint>右上三个按钮切换：弹速明细 / 散布分析 / 测试总览，再点一次收起。</Hint>
      </div>
    ),
  },
  {
    key: "charts-grid",
    view: "charts",
    anchor: "charts-grid",
    placement: "top",
    title: "⑩ 四张图看弹速质量",
    description: (
      <div>
        <div>
          时间序列（均值虚线 + 极值点）、分布直方图、逐发变化趋势、
          移动平均与 ±1σ 带（看一致性最直观）。
        </div>
        <Hint>图跟着左栏当前选中的组走。</Hint>
      </div>
    ),
  },
  {
    key: "shots-table",
    view: "details",
    anchor: "shots-table",
    placement: "top",
    title: "⑪ 弹速明细与掉速详情",
    description: (
      <div>
        <div>
          逐发列表（最新在最上）。勾上「含摩擦轮数据」再导出，
          CSV 里会多出每发的基线、掉速量、掉速 %、恢复时间。
        </div>
        <Hint>点任意一行（或行尾的曲线图标）打开「掉速详情」：六轮波形、基线、
        掉速量、掉速 %、恢复时间，还能隐藏平直通道、调平滑窗口。</Hint>
      </div>
    ),
  },
  {
    key: "dispersion-tools",
    view: "dispersion",
    anchor: "dispersion-tools",
    placement: "bottom",
    title: "⑫ 靶纸散布分析",
    description: (
      <div>
        <div>
          上传靶纸照片 →「裁剪标定」框出有效纸面（A4 横向等）→ 在照片上点弹着点，
          自动算出 R50、平均环数、散布范围。
        </div>
        <Hint>「环数容差」可以自己填；分析结果跟着组一起保存，换台电脑导入也还在。</Hint>
      </div>
    ),
  },
  {
    key: "overview-list",
    view: "overview",
    anchor: "overview-list",
    placement: "top",
    title: "⑬ 测试总览：逐组汇总",
    description: (
      <div>
        <div>
          把当前测试的每个组排成一行：目标弹速、达标率、容差、CV、趋势、
          热枪效应、平均环数等，一眼看出哪组工况最好。
        </div>
        <Hint>容差可自由输入（目标值的百分比），留空则用各组自身均值。</Hint>
      </div>
    ),
  },
  {
    key: "overview-timeline",
    view: "overview",
    anchor: "overview-timeline",
    placement: "top",
    title: "⑭ 跨组时间轴：看热枪效应",
    description: (
      <div>
        <div>
          同一天测的多组按时间排开，弹速整体往上飘就是热枪效应，
          前几发偏快则是冷枪段。
        </div>
        <Hint>按时间顺序排开，可以看出一整天里弹速的整体走势。</Hint>
      </div>
    ),
  },
  {
    key: "export-all",
    view: "charts",
    anchor: "export-all",
    placement: "right",
    title: "⑮ 导出存档",
    description: (
      <div>
        <div>
          侧栏这个按钮导出全部测试（.rmtest，含波形与靶纸）；
          右键单个测试或组可以只导那一份。
        </div>
        <Hint>数据同时存在本地，重开应用会自动接着上次。</Hint>
      </div>
    ),
  },
];

/**
 * 过滤掉当前界面找不到锚点的步骤。
 * `ready` 由调用方决定某一步现在是否可用（视图类步骤要等切换过去再判断）。
 */
export function pickVisibleSteps(
  defs: TourStepDef[],
  ready: (step: TourStepDef) => boolean
): TourStepDef[] {
  return defs.filter(ready);
}

/** 视图切换后等 DOM 渲染完再定位高亮 */
const VIEW_SWITCH_DELAY_MS = 140;

export function OnboardingTour(props: {
  open: boolean;
  /** 当前主区视图，用来判断该不该切换 */
  view: MainView;
  onActivateView: (v: MainView) => void;
  onClose: () => void;
}) {
  const { open, view, onActivateView, onClose } = props;
  const [live, setLive] = useState(false);
  const [steps, setSteps] = useState<TourStepDef[]>(TOUR_STEPS);
  const [current, setCurrent] = useState(0);

  // 打开时先回到图表页（保证仪表盘类锚点都在），渲染完再把"当前视图下拿不到锚点"的步骤去掉。
  // 依赖视图切换的步骤（明细/散布/总览）不在这一步过滤，改由 goTo 切换过去后再判定。
  useEffect(() => {
    if (!open) {
      setLive(false);
      return;
    }
    onActivateView("charts");
    const t = window.setTimeout(() => {
      setSteps(
        pickVisibleSteps(
          TOUR_STEPS,
          (s) => s.view !== "charts" || !s.anchor || tourTarget(s.anchor) !== null
        )
      );
      setCurrent(0);
      setLive(true);
    }, VIEW_SWITCH_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [open, onActivateView]);

  const goTo = useCallback(
    (next: number) => {
      // 逐步推进：某一步的目标在当前界面确实不存在就跳过它（不会卡死）
      const jump = (i: number) => {
        if (i < 0 || i >= steps.length) {
          setLive(false);
          onClose();
          return;
        }
        const step = steps[i];
        const needSwitch = step.view !== view;
        if (needSwitch) onActivateView(step.view);
        const settle = () => {
          if (step.anchor && tourTarget(step.anchor) === null) {
            jump(i + 1);
            return;
          }
          setCurrent(i);
        };
        if (needSwitch) window.setTimeout(settle, VIEW_SWITCH_DELAY_MS);
        else settle();
      };
      jump(next);
    },
    [steps, view, onActivateView, onClose]
  );

  const close = useCallback(() => {
    setLive(false);
    onClose();
  }, [onClose]);

  const tourSteps: TourProps["steps"] = steps.map((s, i) => ({
    title: s.title,
    description: s.description,
    placement: s.placement,
    // 找不到锚点时返回 null，rc-tour 会退化成居中无遮罩的说明面板
    target: s.anchor
      ? ((() => tourTarget(s.anchor!)) as () => HTMLElement)
      : undefined,
    // 滚动要用即时行为：rc-tour 是在 scrollIntoView 之后立刻读
    // getBoundingClientRect 定位遮罩的，平滑滚动还在动的时候量到的还是旧位置，
    // 而内层容器滚动不会冒泡到 window，rc-tour 不会再量一次 → 高亮框会飘。
    scrollIntoViewOptions: { block: "nearest", behavior: "auto" },
    nextButtonProps: {
      children: i === steps.length - 1 ? "完成" : "下一步",
    },
    prevButtonProps: { children: i === 0 ? "" : "上一步" },
  }));

  if (steps.length === 0) return null;

  return (
    <>
    <Tour
      open={live}
      current={current}
      steps={tourSteps}
      onChange={goTo}
      onClose={close}
      onFinish={close}
      zIndex={1300}
      indicatorsRender={(_c, total) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {current + 1} / {total}
        </Text>
      )}
    />
    </>
  );
}

/** 首次启动的欢迎框：问一句再决定要不要塞示例数据 */
export function WelcomeModal(props: {
  open: boolean;
  busy: boolean;
  onStart: (withDemo: boolean) => void;
  onSkip: () => void;
}) {
  return (
    <Modal
      open={props.open}
      title="欢迎使用测速模块上位机"
      centered
      maskClosable={false}
      onCancel={props.onSkip}
      footer={[
        <Button key="later" type="text" onClick={props.onSkip}>
          以后再说
        </Button>,
        <Button key="tour" loading={props.busy} onClick={() => props.onStart(false)}>
          直接开始引导
        </Button>,
        <Button
          key="demo"
          type="primary"
          loading={props.busy}
          onClick={() => props.onStart(true)}
        >
          载入示例数据并开始引导
        </Button>,
      ]}
    >
      <div>
        <p style={{ marginTop: 0 }}>
          看起来你还没有数据。可以先载入一份内置的
          <Text strong>示例数据</Text>
          （弹速、六轮掉速波形、靶纸散布都有），跟着引导边看边学，
          一分钟就能摸清界面怎么用。
        </p>
        <Text type="secondary">
          示例数据会作为一个独立测试并入，随时可以整组删除，不会影响你自己的记录。
        </Text>
      </div>
    </Modal>
  );
}

/** 常驻入口：随时重看引导 / 载入或移除示例数据 */
export function GuideButton(props: { onStartTour: () => void }) {
  const tests = useAppStore((s) => s.tests);
  const [busy, setBusy] = useState(false);
  const hasDemo = demoTestIds(tests).length > 0;

  const loadDemo = async () => {
    setBusy(true);
    try {
      const id = await addDemoProject();
      if (id === null) message.warning("示例数据没能并入，请重试");
      else message.success("已载入示例数据（独立测试，可随时删除）", 4);
    } catch (e) {
      message.error(`载入示例数据失败：${e}`, 6);
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = () => {
    Modal.confirm({
      title: "移除示例数据？",
      content: "只删内置的示例测试，你自己的记录不受影响。",
      okText: "移除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        const n = removeDemoProject();
        if (n > 0) message.success("已移除示例数据");
      },
    });
  };

  const items: MenuProps["items"] = [
    { key: "tour", icon: <CompassOutlined />, label: "开始界面引导" },
    {
      key: "demo",
      icon: <DownloadOutlined />,
      label: "载入示例数据",
      disabled: busy,
    },
    { type: "divider" },
    {
      key: "remove",
      icon: <DeleteOutlined />,
      label: "移除示例数据",
      danger: true,
      disabled: !hasDemo,
    },
  ];

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === "tour") props.onStartTour();
          else if (key === "demo") void loadDemo();
          else if (key === "remove") confirmRemove();
        },
      }}
    >
      <Button type="text" icon={<QuestionCircleOutlined />}>
        使用指南
      </Button>
    </Dropdown>
  );
}
