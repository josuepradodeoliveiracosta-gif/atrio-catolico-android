package br.com.atriocatolico;

import org.junit.Test;
import static org.junit.Assert.*;
import static br.com.atriocatolico.LiturgicalCalendarBR.*;
import java.time.*;

public class LiturgicalCalendarBRTest {
    private Day d(String date) {return day(LocalDate.parse(date));}
    @Test public void renewsAcrossCivilYearsWithoutInterruptingChristmas() {
        assertEquals(Season.CHRISTMAS, d("2028-01-01").season);
        assertEquals("Batismo do Senhor", d("2028-01-09").feast);
        assertEquals("Quarta-feira de Cinzas", d("2028-03-01").feast);
        assertEquals("Domingo da Ressurreição", d("2028-04-16").feast);
        assertEquals("Ascensão do Senhor", d("2028-05-28").feast);
        assertEquals(1, d("2028-12-03").candles);
        assertEquals(Season.CHRISTMAS, d("2029-01-01").season);
    }
    @Test public void boundariesInLocalTime() {
        String[] starts={"2026-11-29","2026-12-25","2027-01-11","2027-02-10","2027-03-26","2027-03-28","2027-05-17","2027-11-28","2027-12-25"};
        Season[] themes={Season.ADVENT,Season.CHRISTMAS,Season.ORDINARY,Season.LENT,Season.TRIDUUM,Season.EASTER,Season.ORDINARY,Season.ADVENT,Season.CHRISTMAS};
        for(int i=0;i<starts.length;i++) {
            LocalDate date=LocalDate.parse(starts[i]); ZonedDateTime previous=date.atStartOfDay(ZoneId.of("America/Fortaleza")).minusMinutes(1);
            assertNotEquals(themes[i],day(previous.toLocalDate()).season);
            assertEquals(themes[i],day(nextChange(previous).toLocalDate()).season);
        }
        assertEquals(d("2026-12-31").season,d("2027-01-01").season);
        ZonedDateTime midnight=ZonedDateTime.parse("2027-03-28T00:00:00-03:00[America/Fortaleza]");
        assertEquals(Season.TRIDUUM,day(midnight.withZoneSameInstant(ZoneId.of("America/Manaus")).toLocalDate()).season);
    }
    @Test public void precedenceAndTransfers() {
        assertTrue(d("2027-03-21").red); assertEquals(Season.LENT,d("2027-03-21").season); assertFalse(d("2027-03-22").red);
        assertEquals("Quinta-feira Santa",d("2027-03-25").feast); assertEquals(Season.LENT,d("2027-03-25").season);
        assertTrue(d("2027-03-26").red); assertEquals("Sábado Santo",d("2027-03-27").feast);
        assertEquals("Anunciação do Senhor",d("2027-04-05").feast); assertEquals("",d("2027-05-06").feast);
        assertEquals("Ascensão do Senhor",d("2027-05-09").feast); assertTrue(d("2027-05-16").red); assertEquals(Season.EASTER,d("2027-05-16").season);
        assertEquals("Epifania do Senhor",d("2027-01-03").feast); assertEquals("Batismo do Senhor",d("2027-01-10").feast);
    }
    @Test public void greetingsAndWreath() {
        assertEquals("Boa noite",greeting(4)); assertEquals("Bom dia",greeting(5)); assertEquals("Bom dia",greeting(11));
        assertEquals("Boa tarde",greeting(12)); assertEquals("Boa tarde",greeting(17)); assertEquals("Boa noite",greeting(18));
        for(int h:new int[]{5,12,18}) {
            ZonedDateTime boundary=LocalDate.parse("2027-05-01").atTime(h,0).atZone(ZoneId.of("America/Fortaleza"));
            assertEquals(boundary,nextChange(boundary.minusSeconds(1)));
        }
        for(int i=0;i<4;i++) assertEquals(i+1,day(LocalDate.parse("2026-11-29").plusWeeks(i)).candles);
    }
}
