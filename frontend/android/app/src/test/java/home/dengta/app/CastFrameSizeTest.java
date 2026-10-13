package home.dengta.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class CastFrameSizeTest {
    @Test public void preservesAspectRatioAndDoesNotUpscale() {
        assertArrayEquals(new int[]{1920,1080}, CastFrameSize.fit(3840,2160));
        assertArrayEquals(new int[]{1080,1920}, CastFrameSize.fit(2160,3840));
        assertArrayEquals(new int[]{640,360}, CastFrameSize.fit(640,360));
    }

    @Test public void largeOrThinSurfacesRemainBoundedWithoutZeroDimensions() {
        for (int[] dimensions : new int[][]{{Integer.MAX_VALUE,1},{1,Integer.MAX_VALUE},{Integer.MAX_VALUE,Integer.MAX_VALUE}}) {
            int[] result = CastFrameSize.fit(dimensions[0],dimensions[1]);
            assertTrue(result[0] > 0 && result[0] <= 1920);
            assertTrue(result[1] > 0 && result[1] <= 1920);
        }
    }

    @Test public void unmeasuredSurfacesAreRejectedBeforeAllocation() {
        assertThrows(IllegalArgumentException.class, () -> CastFrameSize.fit(0,100));
        assertThrows(IllegalArgumentException.class, () -> CastFrameSize.fit(100,-1));
    }
}
