package home.dengta.app;

import org.junit.Test;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class DlnaDiscoveryTest {
    @Test public void activeRequiresBothSocketsAndInitialAliveWaitsForReadiness() throws Exception {
        DlnaDiscovery discovery = new DlnaDiscovery(25);
        CountDownLatch alive = new CountDownLatch(2);
        try {
            long generation = discovery.begin(alive::countDown);
            assertEquals("starting", discovery.snapshot().status);
            assertFalse(discovery.snapshot().active);
            discovery.ready(generation, false);
            assertTrue(discovery.snapshot().ssdpReady);
            assertFalse(discovery.snapshot().httpReady);
            assertFalse(alive.await(60, TimeUnit.MILLISECONDS));
            assertEquals(2, alive.getCount());
            discovery.ready(generation, true);
            assertTrue(discovery.snapshot().active);
            assertEquals("ready", discovery.snapshot().status);
            assertTrue("initial and periodic alive must run", alive.await(2, TimeUnit.SECONDS));
        } finally { discovery.stop(); }
    }

    @Test public void eachSocketFailureIsUnavailableAndOtherSocketCannotClearItsError() {
        for (String code : new String[]{"dlna_ssdp_bind_failed", "dlna_multicast_join_failed", "dlna_network_unavailable"}) {
            DlnaDiscovery discovery = new DlnaDiscovery();
            try {
                long generation = discovery.begin(() -> {});
                discovery.failed(generation, false, code);
                discovery.ready(generation, true);
                assertFalse(discovery.snapshot().active);
                assertEquals("error", discovery.snapshot().status);
                assertEquals(code, discovery.snapshot().errorCode);
                discovery.ready(generation, false);
                assertTrue(discovery.snapshot().active);
                discovery.failed(generation, true, "dlna_http_bind_failed");
                discovery.ready(generation, false);
                assertFalse(discovery.snapshot().active);
                assertEquals("dlna_http_bind_failed", discovery.snapshot().errorCode);
            } finally { discovery.stop(); }
        }
    }

    @Test public void stopAndRestartIgnoreOldWorkerReadinessAndErrors() throws Exception {
        DlnaDiscovery discovery = new DlnaDiscovery(25);
        AtomicInteger oldAlive = new AtomicInteger();
        try {
            long old = discovery.begin(oldAlive::incrementAndGet);
            discovery.stop();
            assertEquals("stopped", discovery.snapshot().status);
            CountDownLatch newAlive = new CountDownLatch(1);
            long current = discovery.begin(newAlive::countDown);
            assertFalse(discovery.ready(old, false));
            assertFalse(discovery.ready(old, true));
            assertFalse(discovery.failed(old, true, "dlna_http_bind_failed"));
            discovery.ready(current, true);
            assertFalse(discovery.snapshot().active);
            discovery.ready(current, false);
            assertTrue(newAlive.await(2, TimeUnit.SECONDS));
            assertEquals(0, oldAlive.get());
            discovery.stop();
            assertFalse(discovery.snapshot().active);
            assertFalse(discovery.snapshot().ssdpReady);
            assertFalse(discovery.snapshot().httpReady);
        } finally { discovery.stop(); }
    }

    @Test public void socketReceiveDoesNotBlockInitialOrPeriodicAnnouncements() throws Exception {
        DlnaDiscovery discovery = new DlnaDiscovery(25);
        InetAddress loopback = InetAddress.getByName("127.0.0.1");
        try (DatagramSocket blocked = new DatagramSocket(0, loopback);
             DatagramSocket listener = new DatagramSocket(0, loopback);
             DatagramSocket sender = new DatagramSocket(0, loopback)) {
            CountDownLatch enteredReceive = new CountDownLatch(1);
            CountDownLatch leftReceive = new CountDownLatch(1);
            Thread receiver = new Thread(() -> {
                enteredReceive.countDown();
                try { blocked.receive(new DatagramPacket(new byte[32], 32)); }
                catch (Exception ignored) {} finally { leftReceive.countDown(); }
            });
            receiver.setDaemon(true);
            receiver.start();
            assertTrue(enteredReceive.await(2, TimeUnit.SECONDS));
            byte[] payload = "synthetic ssdp:alive".getBytes(StandardCharsets.UTF_8);
            long generation = discovery.begin(() -> {
                try { sender.send(new DatagramPacket(payload, payload.length, loopback, listener.getLocalPort())); }
                catch (Exception failure) { throw new AssertionError(failure); }
            });
            discovery.ready(generation, false);
            discovery.ready(generation, true);
            listener.setSoTimeout(2000);
            for (int i = 0; i < 2; i++) {
                DatagramPacket packet = new DatagramPacket(new byte[64], 64);
                listener.receive(packet);
                assertEquals("synthetic ssdp:alive", new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8));
                assertEquals("discovery listener remains blocked", 1, leftReceive.getCount());
            }
            discovery.stop();
            blocked.close();
            assertTrue(leftReceive.await(2, TimeUnit.SECONDS));
        } finally { discovery.stop(); }
    }
}
