import { useXinchaoState } from "./xinchao.js";
import XinchaoCapsule from "./XinchaoCapsule.jsx";
import "./xinchao.css";

/**
 * 心潮徽章：把心潮胶囊挂到状态栏里。
 *
 * 取数和轮询复用 xinchao.js 里已有的 useXinchaoState（60 秒一次、页面隐藏不请求、
 * 失败保留上一次值）。这里只负责「有数据就画，没数据就什么都不画」——
 * 心潮是装饰性信息，不能因为接口挂了就把状态栏弄坏。
 *
 * 做成独立组件的理由：App.jsx 有 18 个测试文件在做源码切片，
 * 在切片区域内加东西会直接把它们打红。挂在 CompanionStatus 里风险最小。
 */
export default function XinchaoBadge({
    enabled = true,
    onOpen = null,
    request = undefined
}) {
    const { state } = useXinchaoState({ enabled, request });
    if (!state) return null;

    return (
        <XinchaoCapsule
            state={state}
            onOpen={onOpen}
            className="xinchao-capsule-in-status"
            as={onOpen ? "button" : "span"}
        />
    );
}
