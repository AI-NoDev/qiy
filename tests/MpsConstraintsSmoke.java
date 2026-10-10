import java.lang.reflect.Method;

class MpsConstraintsSmoke {
  public static void main(String[] args) throws Exception {
    String[] validators = {
      "qiy.constraints.Field_Constraints$Type_PD",
      "qiy.constraints.Index_Constraints$Method_PD",
      "qiy.constraints.IndexColumn_Constraints$FieldName_PD"
    };
    Class<?> nodeType = Class.forName("org.jetbrains.mps.openapi.model.SNode");
    for (String validator : validators) {
      Method validate = Class.forName(validator).getDeclaredMethod("staticValidateProperty", nodeType, String.class);
      validate.setAccessible(true);
      for (String invalid : new String[] { null, "", new String(new char[0]) }) {
        if ((boolean) validate.invoke(null, null, invalid)) {
          throw new AssertionError(validator + " accepted a missing or empty property");
        }
      }
      if (!(boolean) validate.invoke(null, null, "valid")) {
        throw new AssertionError(validator + " rejected a non-empty property");
      }
      System.out.println("Verified native property validator: " + validator);
    }
  }
}
