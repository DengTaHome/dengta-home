package home.dengta.app;

import java.io.IOException;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class CastHlsPlaylistTest {
    @Test public void resolvesLinesAndQuotedUriAttributesWithoutChangingOtherText() throws Exception {
        List<String> urls = new ArrayList<>();
        String source = "#EXTM3U\r\n# comment URI=\"leave-me\"\r\n"
            + "#EXT-X-MEDIA:TYPE=AUDIO,NAME=\"voice,URI=none\",URI=\"../audio/list.m3u8?x=1,2\"\r\n"
            + "#EXT-X-KEY:METHOD=AES-128,URI=\"/key.bin\",IV=0x00\r\n"
            + "#EXT-X-MAP:URI=\"init.mp4\",BYTERANGE=\"4@0\"\r\n"
            + "#EXTINF:5,title\r\nsegment.ts?sig=a%2Fb\r\n";
        String rewritten = HlsPlaylistRewriter.rewrite(source, new URL("https://media.example/video/list.m3u8"), uri -> {
            urls.add(uri); return "http://127.0.0.1/resource/" + urls.size();
        });
        assertEquals(java.util.Arrays.asList("https://media.example/audio/list.m3u8?x=1,2", "https://media.example/key.bin",
            "https://media.example/video/init.mp4", "https://media.example/video/segment.ts?sig=a%2Fb"), urls);
        assertTrue(rewritten.contains("NAME=\"voice,URI=none\""));
        assertTrue(rewritten.contains("# comment URI=\"leave-me\"\r\n"));
        assertTrue(rewritten.contains("IV=0x00\r\n"));
        assertTrue(rewritten.endsWith("http://127.0.0.1/resource/4\r\n"));
    }

    @Test public void drmIdentifiersStayWithThePlayerAndOnlyHttpReferencesAreMapped() throws Exception {
        List<String> urls = new ArrayList<>();
        String output = HlsPlaylistRewriter.rewrite("#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://asset\"\nhttps://cdn.example/segment.ts\n",
            new URL("https://media.example/a.m3u8"), uri -> { urls.add(uri); return "local"; });
        assertTrue(output.contains("skd://asset"));
        assertEquals(java.util.Collections.singletonList("https://cdn.example/segment.ts"), urls);
    }

    @Test public void rejectsInvalidOrUnsupportedPlaylistsBeforePretendingTheyAreUsable() throws Exception {
        for (String source : new String[]{"<html>error</html>", "#EXTM3U\n{$unknown}/a.ts\n", "#EXTM3U\n#EXT-X-MAP:URI=unquoted\n",
                "#EXTM3U\nfile:///private/segment\n", "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"file:///private/key\"\n"}) {
            try {
                HlsPlaylistRewriter.rewrite(source, new URL("https://media.example/list.m3u8"), uri -> uri);
                fail("invalid playlist was accepted");
            } catch (IOException expected) { }
        }
        StringBuilder large = new StringBuilder("#EXTM3U\n");
        for (int i = 0; i < 4097; i++) large.append("segment.ts\n");
        try {
            HlsPlaylistRewriter.rewrite(large.toString(), new URL("https://media.example/list.m3u8"), uri -> uri);
            fail("reference limit was ignored");
        } catch (IOException expected) { }
    }
}
