package dev.qiy.intellij

import com.intellij.lang.Language
import com.intellij.openapi.fileTypes.LanguageFileType
import javax.swing.Icon

object QiyLanguage : Language("Qiy")

object QiyFileType : LanguageFileType(QiyLanguage) {
    override fun getName() = "Qiy"
    override fun getDescription() = "Qiy application model"
    override fun getDefaultExtension() = "qiy"
    override fun getIcon(): Icon? = null
}
