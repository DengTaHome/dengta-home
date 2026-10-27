import { useState } from "react";
import { useXinchaoState } from "./xinchao.js";
import XinchaoCapsule from "./XinchaoCapsule.jsx";
import XinchaoDetails from "./XinchaoDetails.jsx";
import "./xinchao.css";

/**
 * 心潮徽章：胶囊挂在状态栏里，点击展开详情。
 *
 * 取数和轮询复用 xinchao.js 里的 useXinchaoState（60 秒一次、页面隐藏不请求、
 * 失败保留上一次值）。这里只负责「有数据就画，没数据就什么都不画」——
 * 心潮是装饰性信息，不能因为接口挂了就把状态栏弄坏。
 *
 * 详情面板（XinchaoDetails）以前没有任何人渲染，导致「每条驱动项的进度条」
 * 这个界面根本不存在。现在由胶囊点击打开，两个组件都真正可达了。
 *
 * 做成独立组件的理由：App.jsx 有十几个测试文件在做源码切片，
 * 在切片区域内加东西会直接把它们打红。挂在 CompanionStatus 里风险最小。
 */
export default function XinchaoBadge({
    enabled = true,
    onOpen = null,
    request = undefined,
    aiName = "伴侣"
}) {
    const { state } = useXinchaoState({ enabled, request });
    const [detailsOpen, setDetailsOpen] = useState(false);

    if (!state) return null;

    const openDetails = () => {
        if (onOpen) {
            // 调用方想自己接管（例如嵌进状态面板里）就交给它。
            onOpen(state);
            return;
        }
        setDetailsOpen((current) => !current);
    };

    return (
        <>
            <XinchaoCapsule
                state={state}
                onOpen={openDetails}
                className="xinchao-capsule-in-status"
                as="button"
            />
            {detailsOpen ? (
                <XinchaoDetails
                    state={state}
                    aiName={aiName}
                    onClose={() => setDetailsOpen(false)}
                />
            ) : null}
        </>
    );
}
