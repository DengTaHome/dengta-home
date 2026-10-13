package home.dengta.app;

final class CastFrameSize {
    static int[] fit(int width, int height) {
        if (width <= 0 || height <= 0) throw new IllegalArgumentException("capture_not_ready");
        double scale = Math.min(1d, 1920d / Math.max(width, height));
        return new int[]{Math.max(1, (int) (width * scale)), Math.max(1, (int) (height * scale))};
    }
    private CastFrameSize() {}
}
