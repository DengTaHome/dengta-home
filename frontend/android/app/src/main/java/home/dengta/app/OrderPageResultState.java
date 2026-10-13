package home.dengta.app;

final class OrderPageResultState {
    private String result;
    private boolean published;
    boolean stage(String value) {
        if (result != null) return false;
        result = value;
        return true;
    }
    boolean stopped() { return result != null; }
    String result() { return result; }
    boolean published() { return published; }
    void markPublished() { published = true; }
}
